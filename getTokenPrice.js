const Web3 = require('web3');
require('dotenv').config();

const uniswapFactoryAbi = require('./abis/FactoryABI.json');
const uniswapPairAbi = require('./abis/PairABI.json');

const routers = require('./addresses/addresses.json');
const tokens = require('./addresses/tokens.json');
const zero = '0x0000000000000000000000000000000000000000';

const eth = new Web3(new Web3.providers.HttpProvider(process.env.ETH));
const bsc = new Web3(new Web3.providers.HttpProvider(process.env.BSC));

async function getTokenPrice(routerContract, decimals, wToken, tokenAddress, isBuy) {
    let path = [tokenAddress, wToken];
    let wei = (10**decimals).toString();

    let price = await getAmounts(routerContract, wei, path, isBuy);
    if(price) return [price, false];

    let USDCPair = wToken == tokens.WETH ? tokens.USDC_ETH : tokens.USDC_BSC;
    path = [tokenAddress, USDCPair];

    price = await getAmounts(routerContract, wei, path, isBuy);
    if(price) return [price, true];

    let factoryAbi = wToken == tokens.WETH ? routers.UNISWAPV2FACTORY : routers.PANCAKESWAPFACTORY
    let USDC = wToken == tokens.WETH ? tokens.USDC_ETH : tokens.USDC_BSC;

    price = await getReservesPrice(factoryAbi, tokenAddress, wToken, USDC, isBuy, decimals);
    if(price) return price

    throw new Error('Cannot get price of a token');
}

async function getAmounts(routerContract, wei, path, isBuy) {
    try{
        price = await routerContract.methods.getAmountsOut(wei, path).call();
        price = price[1];
        price /= 10**18;
        if(price) return isBuy ? price : 1/price;
    } catch(error) {}

}

async function getReservesPrice(factoryAddress, tokenAddress, wToken, USDC, isBuy, decimals) {
    let pairContract = await getPairAddress(tokenAddress, wToken, factoryAddress);
    let pairToken = wToken;
    if(!pairContract) {
        pairContract = await getPairAddress(tokenAddress, USDC, factoryAddress);
        pairToken = USDC;
    }

    try{
        let reserves = await pairContract.methods.getReserves().call();

        let token0 = await pairContract.methods.token0().call();
        let price = token0 != pairToken ? reserves[1] / reserves[0] : reserves[0] / reserves[1];

        price = price / (10 ** (18 - decimals));
        price = isBuy ? price : 1/price;
        return [price, pairContract == USDC];
    } catch(error) {}

    return undefined;
}

async function getPairAddress(tokenAddress, pairToken, factoryAddress) {
    let web3 = factoryAddress == routers.UNISWAPV2FACTORY ? eth : bsc;
    try{
        let factory = new web3.eth.Contract(uniswapFactoryAbi, factoryAddress);
        let pairAddress = await factory.methods.getPair(tokenAddress, pairToken).call();
        return pairAddress == zero ? undefined : new web3.eth.Contract(uniswapPairAbi, pairAddress);
    } catch(error) {}
}

module.exports = getTokenPrice;