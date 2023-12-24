const erc20Abi = require('./abis/TokenABI.json');
const symbolAbi = require('./abis/SymbolABI.json');

async function getMarketCap(web3, tokenAddress, decimals) {
    let token = new web3.eth.Contract(erc20Abi, tokenAddress);
    let totalSupply = await token.methods.totalSupply().call();
    let balance = await token.methods.balanceOf(token.options.address).call();
    let burnt = await token.methods.balanceOf('0x000000000000000000000000000000000000dead').call();
    if(!burnt)
        burnt = await token.methods.balanceOf('0x0000000000000000000000000000000000000000').call();
    let marketCap = (totalSupply - balance - burnt) / 10**decimals;
    return marketCap;
}

async function getTokenInfo(web3, tokenAddress) {
    let symbol, decimals;
    try{
        let tokenContract = new web3.eth.Contract(erc20Abi, tokenAddress);
        decimals = await tokenContract.methods.decimals().call();
        symbol = await tokenContract.methods.symbol().call();
        return [symbol, decimals];
    } catch(error) {}

    try{
        let tokenContract = new web3.eth.Contract(symbolAbi, tokenAddress);
        decimals = await tokenContract.methods.decimals().call();
        symbol = await tokenContract.methods.symbol().call();
        symbol = await web3.utils.hexToString(symbol);
        return [symbol, decimals];
    } catch(error) {}

    throw new Error('Can not get token info');
}

async function approveToken(web3, routerContract, tokenAddress, account, amount) {
    try{
        let tokenContract = new web3.eth.Contract(erc20Abi, tokenAddress);
        let data = await tokenContract.methods.approve(routerContract.options.address, amount).encodeABI();
        let gas = await tokenContract.methods.approve(routerContract.options.address, amount).estimateGas({from: account.address});
        await sendTransaction(web3, account, tokenAddress, gas, data, 0);
    } catch(error) {}
}

module.exports = [getTokenInfo, getMarketCap, approveToken];