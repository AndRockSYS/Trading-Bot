const axios = require('axios');
require('dotenv').config();

const bscApi = process.env.BSC_TAX;
const ethApi = process.env.ETH_TAX;

const erc20Abi = require('./abis/TokenABI.json');

async function getTax(web3, tokenAddress, isEth) {  
    let contract = new web3.eth.Contract(erc20Abi, tokenAddress);

    let buyFee, sellFee;
    try{
        buyFee = await contract.methods.buyTax().call();
        sellFee = await contract.methods.sellTax().call();
        return[buyFee, sellFee];
    } catch(error) {}

    try{
        let fee = await contract.methods.totalFee().call();
        return[fee, fee];
    } catch(error) {}

    try{
        buyFee = await contract.methods.getTotalFee(false).call();
        sellFee = await contract.methods.getTotalFee(true).call();
        buyFee /= buyFee > 100 ? 100 : buyFee > 10 ? 10 : 1;
        sellFee /= sellFee > 100 ? 100 : sellFee > 10 ? 10 : 1;
        return[buyFee, sellFee];
    } catch(error) {}

    try{
        buyFee = await contract.methods.BuyFees().call();
        sellFee = await contract.methods.SellFees().call();
        buyFee = parseInt(buyFee['1']);
        sellFee = parseInt(sellFee['1']);
        buyFee /= buyFee > 100 ? 100 : buyFee >= 10 ? 10 : 1;
        sellFee /= sellFee > 100 ? 100 : sellFee >= 10 ? 10 : 1;
        return[buyFee, sellFee];
    } catch(error) {}

    let url = isEth ? ethApi : bscApi;
    try{
        let data = await axios.get(url + tokenAddress);
        if(!data.data.Error) return [data.data.BuyTax, data.data.SellTax];
    } catch(error) {}
    
    return[0,0];
}

module.exports = getTax;