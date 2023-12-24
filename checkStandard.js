const uniswapAbi = require('./abis/RouterABI.json');
const uniswapPairAbi = require('./abis/PairABI.json');
const uniswapFactoryAbi = require('./abis/FactoryABI.json');

const routers = require('./addresses/addresses.json');
const tokens = require('./addresses/tokens.json')

async function checkStandard(tokenAddress, eth, bsc) {
    
    let [contract, wToken, isETh] = await checkToken(eth, tokenAddress, tokens.WETH, routers.UNISWAPV2, routers.UNISWAPV2FACTORY);
    if(!contract) 
        [contract, wToken, isETh] = await checkToken(bsc, tokenAddress, tokens.WBNB, routers.PANCAKESWAP, routers.PANCAKESWAPFACTORY);

    if(!contract) 
        throw new Error('Unsupported chain or standart');
    
    return [contract, wToken, isETh]
}

async function checkToken(web3, tokenAddress, wToken, router, factory) {
    try{
        let contract = new web3.eth.Contract(uniswapAbi, router);
        await contract.methods.getAmountsOut('1000', [tokenAddress, wToken]).call();
        return [contract, wToken, wToken == tokens.WETH];
    } catch(error) {}

    try{
        let usdc = wToken == tokens.WETH ? tokens.USDC_ETH : tokens.USDC_BSC;
        let contract = await getPairContract(web3, tokenAddress, usdc, factory);
        if(contract)
            return [new web3.eth.Contract(uniswapAbi, router), wToken, wToken == tokens.WETH];
    } catch(error) {}

    return [undefined, undefined, undefined];
}

async function getPairContract(web3, tokenAddress, pairToken, factoryAddress) {
    try{
        let factory = new web3.eth.Contract(uniswapFactoryAbi, factoryAddress);
        let pairAddress = await factory.methods.getPair(tokenAddress, pairToken).call();
        return pairAddress == zero ? undefined : new web3.eth.Contract(uniswapPairAbi, pairAddress);
    } catch(error) {}
}

module.exports = checkStandard;