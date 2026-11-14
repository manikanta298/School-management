export function parseCsv(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=ch;}
  else if(ch==='"')quoted=true;
  else if(ch===','){row.push(cell);cell='';}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}
  else cell+=ch;
 }
 if(cell!==''||row.length){row.push(cell);rows.push(row);}
 return rows.filter(r=>r.some(c=>c.trim()!==''));
}
// Empty cells are omitted so a blank never overwrites saved data.
export function rowsFromCsv(text){
 const [header,...body]=parseCsv(text.replace(/^\uFEFF/,''));
 if(!header)return [];
 const keys=header.map(h=>h.trim());
 return body.map(cells=>Object.fromEntries(keys.map((k,i)=>[k,(cells[i]??'').trim()]).filter(([k,v])=>k&&v!=='')));
}
