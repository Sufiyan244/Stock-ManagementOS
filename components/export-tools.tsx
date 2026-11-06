'use client';
export function ExportTools({filename}:{filename:string}){
 function download(){const rows=Array.from(document.querySelectorAll('.data-table tr'));const csv=rows.map(r=>Array.from(r.querySelectorAll('th,td')).map(c=>'"'+(c.textContent||'').replaceAll('"','""').trim()+'"').join(',')).join('\r\n');const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename+'.csv';a.click();URL.revokeObjectURL(url);}
 return <div className="no-print flex flex-wrap gap-2"><button type="button" className="btn btn-secondary" onClick={download}>Excel (CSV)</button><button type="button" className="btn btn-secondary" onClick={()=>window.print()}>Print / Save PDF</button></div>;
}