'use client';
export function PrintButton(){return <button type="button" className="btn no-print" onClick={()=>window.print()}>Print invoice</button>;}