export function attendanceAnalysis(counts){
 const segments=[['Present','present','#078274'],['Late','late','#c88b25'],['Absent','absent','#8b69b0'],['Excused','excused','#3d85b3']].map(([label,key,color])=>({label,key,color,value:Number(counts[key]??0)}));
 const total=segments.reduce((sum,s)=>sum+s.value,0);
 return {segments,total,percent:total?100*(segments[0].value+segments[1].value)/total:null};
}
export function publicationAnalysis(exams){const published=Number(exams.published??0),draft=Number(exams.draft??0),total=published+draft;return {published,draft,total,percent:total?100*published/total:null};}
export function overdueAnalysis(balance){const outstanding=BigInt(balance.outstanding_minor??0),overdue=BigInt(balance.overdue_minor??0);return outstanding>0n?Number(overdue*10000n/outstanding)/100:null;}
