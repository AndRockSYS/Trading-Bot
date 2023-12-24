const {Telegraf} = require('telegraf');
const Web3 = require('web3');
const axios = require('axios');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM, {handlerTimeout: 9_000_000});

const eth = new Web3(new Web3.providers.HttpProvider(process.env.ETH));
const bsc = new Web3(new Web3.providers.HttpProvider(process.env.BSC));

const dbUrl = 'https://trading-bot-database.herokuapp.com';

let rounds = new Map();
let users = new Map();

const erc20Abi = require('./abis/TokenABI.json');

const getTax = require('./getTax');
const [convertPrice, convertAmount] = require('./convertNumbers');
const checkStandard = require('./checkStandard');
const getTokenPrice = require('./getTokenPrice');
const [getTokenInfo, getMarketCap, approveToken] = require('./forToken');

const tokens = require('./addresses/tokens.json');

//Returns USDC/WETH price
async function getWETHPrice(routerContract, isEth) {
    let wei = (10**18).toString();
    let path = isEth ? [tokens.WETH, tokens.USDC_ETH] : [tokens.WBNB, tokens.USDC_BSC];
    let decimals = isEth ? 6 : 18;
    try{
        let price = await routerContract.methods.getAmountsOut(wei, path).call();
        price = price[1]/10**decimals;
        return price;
    } catch(error) {return undefined}
}

async function sendTransaction(web3, account, contractAddress, gas, data, amountIn) {
    try{
        let gasPrice = await web3.eth.getGasPrice();
        gasPrice = Math.floor(gasPrice*1.1);
        let tx = await web3.eth.accounts.signTransaction({
            from: account.address,
            to: contractAddress,
            value: amountIn,
            gas: gas + 10000,
            gasPrice: gasPrice,
            data: data
        }, account.privateKey);
        return await web3.eth.sendSignedTransaction(tx.rawTransaction);
    } catch(error) {return false}
}

function getAmounts(amountIn, price, decimals, isBuy, username) {
    let round = rounds.get(username);

    let amountOut = round.value / price;

    let decimalsIn = isBuy ? 18 : decimals;
    let decimalsOut = isBuy ? decimals : 18;
    amountIn *= 10**decimalsIn;
    
    amountOut = amountOut*10**decimalsOut;
    amountOut -= amountOut*(round.tolerance/100);

    amountIn = Math.floor(amountIn);
    amountOut = Math.floor(amountOut);

    amountIn = amountIn.toLocaleString('fullwide', {useGrouping:false});
    amountOut = amountOut.toLocaleString('fullwide', {useGrouping:false});

    return [amountIn, amountOut];
}

async function monitor(web3, ctx, routerContract, decimals, wToken, tokenAddress, username) {
    let round = rounds.get(username);
    round.isActive = true;
    rounds.set(username, round);

    let isBuy = round.isBuy;

    let [startPrice, isUSDC] = await getTokenPrice(routerContract, decimals, wToken, tokenAddress, isBuy);
    if(isUSDC) {
        let WETHPrice = await getWETHPrice(routerContract, round.isEth);
        startPrice *= 1/WETHPrice;
    }

    while(!round.isManuallyStoped && round.isActive) {
        round = rounds.get(username);

        let [currentPrice, isUSDC] = await getTokenPrice(routerContract, decimals, wToken, tokenAddress, isBuy);
        if(isUSDC) {
            let WETHPrice = await getWETHPrice(routerContract, round.isEth);
            startPrice *= 1/WETHPrice;
        }

        let diff = isBuy ? startPrice - currentPrice : currentPrice - startPrice;
        if(diff / startPrice * 100 >= round.percentage) {

            let [amountIn, amountOut] = getAmounts(round.value, currentPrice, decimals, isBuy, username);
        
            let deadline = Date.now() + 60000;
            let gas, data;

            let user = users.get(username);
            let account = {address: user.address, privateKey: user.privateKey};

            try{
                if(isBuy) {
                    data = await routerContract.methods.swapExactETHForTokens(amountOut, [wToken, tokenAddress], account.address, deadline).encodeABI();
                    gas = await routerContract.methods.swapExactETHForTokens(amountOut, [wToken, tokenAddress], account.address, deadline).estimateGas({
                        from: account.address,
                        value: amountIn
                    });
                } else {
                    await approveToken(web3, routerContract, tokenAddress, account, amountIn);
                    data = await routerContract.methods.swapExactTokensForETH(amountIn, amountOut, [tokenAddress, wToken], account.address, deadline).encodeABI();
                    gas = await routerContract.methods.swapExactTokensForETH(amountIn, amountOut, [tokenAddress, wToken], account.address, deadline).estimateGas({
                        from: account.address,
                    });
                }
            } catch(error) {}

            let result = await sendTransaction(web3, account, routerContract.options.address, gas, data, isBuy ? amountIn : 0);
            if(!result) {
                ctx.reply('Can not buy/sell tokens \nPossible issues: \n1) Low balance - can not pay for gas \n2) Unsupported chain or standart(V3)');
                round.isManuallyStoped = true;
            }

        } else await new Promise(resolve => setTimeout(resolve, 10000));
    }

    round = rounds.get(username);
    let message = !round.isManuallyStoped ? `Round was successfully closed!` : `The bot was stopped`
    ctx.reply(message);
}

function createNewRound(username) {
    let newRound = {
        tolerance: 10,

        isActive: false,
        isManuallyStoped: false,

        percentage: 0,
        token: 0,
        amount: 0,
        isEth: false,
        isBuy: false,

        erc: 0
    }
    rounds.set(username, newRound)
    return newRound;
}

bot.start(async ctx => {
    let username = ctx.message.from.username;

    if(users.get(username)) {
        ctx.reply('You already have an account!');
        return;
    }

    let user = await axios.get(`${dbUrl}/${username}?api=${process.env.DB_API}`);
    user = user.data;

    if(!user) {
        let account = await eth.eth.accounts.create();

        let newUser = {username: username, address: account.address, privateKey: account.privateKey}

        let result = await axios.post((`${dbUrl}/?api=${process.env.DB_API}`), newUser)
        if(!result.data)throw new Error('Cannot create an accout');

        users.set(newUser);

        bot.telegram.sendMessage(ctx.chat.id, `*Your account* \nAddress \n` + '`' + `${account.address}`
        + '`' + `\nPrivate Key `+ '`' + `\n${account.privateKey}`+ '`', {
            parse_mode: 'MarkdownV2'
        });
    } else {
        users.set(username, user);
        ctx.reply('Your account is up to date!')
    }
});

bot.help(ctx => {
    bot.telegram.sendMessage(ctx.chat.id, `*Send token address to start\\!* \n/sp PERCENTAGE \\- set slippage tolerance
    \n/balance \\- check balance of your wallet \n/delete \\- delete an existing wallet \n_If you want to create a new one after it, send /start_
    \n*If the bot has restarted, send /start to update account*`, {
    parse_mode: 'MarkdownV2'
    });
});

bot.hears(/0x[a-fA-F0-9]{40}$/, async ctx => {
    let username = ctx.message.from.username;

    let user = users.get(username);
    if(!user) {
        ctx.reply(`Server was restarted \nSend /start to fetch your account`);
        return;
    }

    let tokenAddress = ctx.message.text;

    let [routerContract, wToken, isEth] = await checkStandard(tokenAddress, eth, bsc);

    let web3 = isEth ? eth : bsc;

    let [symbol, decimals] = await getTokenInfo(web3, tokenAddress);

    let [tokenBuyPrice, isUSDC] = await getTokenPrice(routerContract, decimals, wToken, tokenAddress, true);

    let [buyFee, sellFee] = await getTax(web3, tokenAddress, isEth);

    let WETHPrice = await getWETHPrice(routerContract, isEth);

    let USDCPrice = isUSDC ? tokenBuyPrice : tokenBuyPrice * WETHPrice;

    let marketCap = await getMarketCap(web3, tokenAddress, decimals);
    marketCap *= USDCPrice;

    let round = createNewRound(username);
    round.token = tokenAddress;
    round.isEth = isEth;
    rounds.set(username, round);

    let balance = await web3.eth.getBalance(users.get(username).address);
    balance == parseFloat(balance/10**18);
    let keyboard = {
        inline_keyboard: [
            [
                {text: 'Buy', callback_data: 'buy'}
            ],
            [
                {text: 'Sell', callback_data: 'sell'}
            ]
        ]
    };
    let message = '';
    if(balance == 0 && balance <= 0.0001) {
        message = 'Your balance is too low to continue!';
        keyboard = {};
    }
    bot.telegram.sendMessage(ctx.chat.id, `⛓${isEth ? 'ETH' : 'BSC'} \n🪙${symbol} 
    \nPrice: ${convertPrice(USDCPrice)}$ \nMCap: ${convertAmount(marketCap)}$ \nTax: ${buyFee} | ${sellFee}
    \n${message}`, {
        reply_markup: keyboard
    });
});

bot.action(['buy', 'sell'], ctx => {
    ctx.answerCbQuery();

    let username = ctx.callbackQuery.from.username;
    let round = rounds.get(username);
    round.isBuy = ctx.callbackQuery.data == 'buy';
    rounds.set(username, round);

    let messageToSend = round.isBuy ? `Send the amount of ${round.isEth ? 'ETH' : 'BNB'} tokens you want to spend \nExample: 0.1; 43; 0.223` :
    `Choose amount of ERC-20 tokens to spend`;
    let keyboard = round.isBuy ? {} : {
        reply_markup: {
            inline_keyboard: [
                [
                    {text: '25%', callback_data: '25'},
                    {text: '50%', callback_data: '50'}
                ],
                [
                    {text: '75%', callback_data: '75'},
                    {text: '100%', callback_data: '100'}
                ]
            ]
        }
    }
    bot.telegram.editMessageText(ctx.chat.id, ctx.callbackQuery.message.message_id, undefined, messageToSend, keyboard);
});

bot.hears(/\d{1,}[,.]\d{1,}(%)|\d{1,}(%)/, ctx => {
    let percentage = /\d{1,}[,.]\d{1,}|\d{1,}/.exec(ctx.message.text)[0];
    percentage = percentage.toString().replace(',','.');
    percentage = parseFloat(percentage);
    if(!percentage || percentage > 1_000_000_000_000 || percentage < 0) throw new Error('Incorrect percentage input');

    let username = ctx.message.from.username;
    let round = rounds.get(username);
    round.percentage = percentage;
    rounds.set(username, round);
    
    let currencyMsg = round.isBuy ? round.isEth ? 'ETH' : 'BNB' : 'tokens';
    let amountMsg = round.erc ? `${round.erc}%` : round.amount;

    bot.telegram.sendMessage(ctx.chat.id, `Your round 
    \nAddress: ${round.token} \nAmount to spend: ${amountMsg} ${currencyMsg} \nPrice Change: ${round.percentage}%
    \nSlippage tolerance: ${round.tolerance}%`, {
        reply_markup: {
            inline_keyboard: [
                [
                    {text: 'Start', callback_data: 'start'},
                    {text: 'Remake', callback_data: 'remake'}
                ]
            ]
        }
    });
});

bot.hears(/\d{1,}[,.]\d{1,}|\d{1,}/, ctx => {
    let value = /\d{1,}[,.]\d{1,}|\d{1,}/.exec(ctx.message.text)[0];
    value = value.replace(',','.');
    value = parseFloat(value);

    if(!value) throw new Error('Incorrect value format');

    let username = ctx.message.from.username;
    let round = rounds.get(username);
    round.amount = value;
    rounds.set(username, round);

    ctx.reply(`Enter the percentage by which you would like the price of the token to change \nFor example: 0.5%; 1%; 20%`);
});

bot.action('start', async ctx => {
    ctx.answerCbQuery();
    let username = ctx.update.callback_query.from.username;
    let round = rounds.get(username);

    if(round.isActive) {
        ctx.reply('Stop current round to start the next');
        return;
    }

    let user = users.get(username);

    let tokenAddress = round.token;

    let [routerContract, wToken, ] = await checkStandard(tokenAddress, eth, bsc);

    let web3 = round.isEth ? eth : bsc;

    let [symbol, decimals] = await getTokenInfo(web3, tokenAddress);

    let tokenContract = new web3.eth.Contract(erc20Abi, tokenAddress);

    let balance = round.isBuy ? await web3.eth.getBalance(user.address) : await tokenContract.methods.balanceOf(user.address).call();
    let temp = round.isBuy ? balance/10**18 : balance/10**decimals;

    if(!isBuy) {
        round.amount = balance*round.ercPercentage;
        rounds.set(username, round);
    }

    if(balance == 0 || temp < round.amount) throw new Error('Balance is too low');

    bot.telegram.sendMessage(ctx.chat.id, `🔥NEW ${isBuy ? 'BUY' : 'SELL'} round has started \n🪙 ${symbol} \nMonitoring...`, {
        reply_markup: {
            inline_keyboard: [
                [
                    {text: 'Stop', callback_data: 'stop'}
                ]
            ]
        }
    })
    monitor(web3, ctx, routerContract, decimals, wToken, tokenAddress, username);
});

bot.command('delete', async ctx => {
    let username = ctx.message.from.username;
    if(!users.get) throw new Error('You do not have an account');

    let result = await axios.delete(`${dbUrl}/${username}?api=${process.env.DB_API}`);
    if(!result.data) throw new Error('Cannot delete your account');

    users.delete(username);
    ctx.reply('Your account was successfully deleted \nSend /start to create new one');
});

bot.command('balance', async ctx => {
    let user = users.get(ctx.message.from.username);
    if(!user) throw new Error('You do not have an account');
    let ethBalance = await eth.eth.getBalance(user.address);
    let bscBalance = await bsc.eth.getBalance(user.address);
    ethBalance /= 10**18;
    bscBalance /= 10**18;
    ctx.reply(`Wallet balances \n${ethBalance.toFixed(4)} ETH \n${bscBalance.toFixed(4)} BNB\n`)
});

bot.action('stop', ctx => {
    let username = ctx.callbackQuery.from.username;
    let round = rounds.get(username);
    round.isManuallyStoped = true;
    rounds.set(username, round);

    ctx.reply('The bot will be stopped');
});

bot.action(['25', '50', '75', '100'], ctx => {
    ctx.answerCbQuery();

    let username = ctx.callbackQuery.from.username;
    let round = rounds.get(username);
    round.erc = ctx.callbackQuery.data;
    rounds.set(username, round);

    ctx.reply(`Enter the percentage by which you would like the price of the token to change \nFor example: 0.5%; 1%; 20%`);
});

bot.command('sp', ctx => {
    let tolerance = ctx.message.text.split(' ');
    if(tolerance.length != 2) throw new Error('Incorrect tolerance input')

    tolerance = tolerance[1];
    tolerance = tolerance.toString().replace(',','.');
    tolerance = parseFloat(tolerance);
    if(!tolerance || tolerance > 100) throw new Error('Incorrect tolerance input');

    let username = ctx.message.from.username;
    let round = rounds.get(username);
    round.tolerance = tolerance;
    rounds.set(username, round);

    ctx.reply(`The tolerance - ${tolerance}%`);
});

bot.action('remake', ctx => {
    ctx.deleteMessage();
    ctx.reply("Send token address");
});

bot.catch((error, ctx) => {
    ctx.reply(`Error - ${error.message}`);
});

bot.launch();