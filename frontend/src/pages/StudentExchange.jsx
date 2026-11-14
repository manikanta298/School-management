import React,{useState} from 'react';
import {api,apiText} from '../api/client';
import {rowsFromCsv} from '../api/csv';
export default function StudentExchange(){
 const [rows,setRows]=useState([]),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function download(){setBusy(true);setError('');try{const blob=new Blob([await apiText('/students/export.csv')],{type:'text/csv'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='students.csv';link.click();URL.revokeObjectURL(link.href);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function choose(e){
  const file=e.target.files[0];setPreview(null);setNotice('');setError('');if(!file)return;
  try{const parsed=rowsFromCsv(await file.text());setRows(parsed);setPreview(await api('/students/bulk-update',{method:'POST',body:{dry_run:true,rows:parsed}}));}catch(err){setRows([]);setError(err.message);}
 }
 async function apply(){setBusy(true);setError('');try{const result=await api('/students/bulk-update',{method:'POST',body:{dry_run:false,rows}});setPreview(result);if(result.applied){setNotice(`${result.results.length} student record(s) updated.`);setRows([]);}}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="card" aria-label="Student data exchange"><h2>Export and bulk update</h2>
 <p>Download all student profiles as CSV, edit the columns you want to change, and upload the file. Rows are matched by admission_number. Empty cells are ignored. Up to 200 rows per file; nothing is saved unless every row is valid.</p>
 <button disabled={busy} onClick={download}>Download students CSV</button>
 <label>Upload CSV for bulk update<input type="file" accept=".csv,text/csv" onChange={choose} disabled={busy}/></label>
 {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 {preview&&<><p role="status">{preview.valid?`All ${preview.results.length} row(s) are valid.`:'Fix the rows below and upload again.'}{preview.applied?' Changes were saved.':''}</p>
 {preview.results.filter(r=>r.errors.length).map(r=><p className="error" key={r.row}>Row {r.row} ({r.admission_number||'no admission number'}): {r.errors.join('; ')}</p>)}
 {preview.valid&&!preview.applied&&<button disabled={busy} onClick={apply}>Apply {preview.results.length} update(s)</button>}</>}
 </section>;
}
