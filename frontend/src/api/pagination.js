import {api} from './client';
export async function allPages(path){
 const items=[];
 for(let offset=0;;offset+=100){const result=await api(`${path}${path.includes('?')?'&':'?'}limit=100&offset=${offset}`);items.push(...result.items);if(result.items.length<100)return items;}
}
