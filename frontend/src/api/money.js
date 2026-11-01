export function parseMoney(value){
 if(!/^\d{1,8}(\.\d{1,2})?$/.test(value))throw new Error('Enter an amount with up to two decimal places.');
 const [whole,fraction='']=value.split('.'),minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(minor<1||minor>1000000000)throw new Error('Amount must be between 0.01 and 10,000,000.00.');return minor;
}
export function formatMoney(value,currency='INR'){const amount=BigInt(value??0);return `${currency} ${(amount/100n).toLocaleString('en-IN')}.${String(amount%100n).padStart(2,'0')}`;}
export function moneyInput(value){const amount=BigInt(value);return `${amount/100n}.${String(amount%100n).padStart(2,'0')}`;}
