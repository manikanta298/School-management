import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate,authorize } from '../middleware/auth.js';
import { validate } from '../validators/auth.js';
import * as v from '../validators/calendar.js';
import { fail } from '../services/auth.js';
export const calendarRouter=Router();
const admin=authorize('admin');
const columns='id,title,description,event_type,starts_on::text AS starts_on,ends_on::text AS ends_on';
calendarRouter.use(authenticate,(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
calendarRouter.param('id',(_req,res,next,value)=>v.id.safeParse(value).success?next():res.status(400).json({message:'Invalid record ID'}));
// Events overlapping the range are returned; the default window starts today.
calendarRouter.get('/',async(req,res)=>{
 const q=v.listQuery.safeParse(req.query);if(!q.success)return res.status(400).json({message:'Invalid query'});
 const {from,to,event_type,limit}=q.data;
 res.json({items:(await pool.query(`SELECT ${columns} FROM school_events WHERE ends_on>=coalesce($1::date,CURRENT_DATE) AND ($2::date IS NULL OR starts_on<=$2::date) AND ($3::text IS NULL OR event_type=$3) ORDER BY starts_on,id LIMIT $4`,[from??null,to??null,event_type??null,limit])).rows});
});
calendarRouter.post('/',admin,validate(v.event),async(req,res)=>{const d=req.body;const {rows:[row]}=await pool.query(`INSERT INTO school_events(title,description,event_type,starts_on,ends_on,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${columns}`,[d.title,d.description,d.event_type,d.starts_on,d.ends_on,req.user.id]);res.status(201).json({item:row});});
calendarRouter.put('/:id',admin,validate(v.event),async(req,res)=>{const d=req.body;const {rows:[row]}=await pool.query(`UPDATE school_events SET title=$2,description=$3,event_type=$4,starts_on=$5,ends_on=$6,updated_at=now() WHERE id=$1 RETURNING ${columns}`,[req.params.id,d.title,d.description,d.event_type,d.starts_on,d.ends_on]);if(!row)throw fail(404,'Event not found');res.json({item:row});});
calendarRouter.delete('/:id',admin,async(req,res)=>{const {rowCount}=await pool.query('DELETE FROM school_events WHERE id=$1',[req.params.id]);if(!rowCount)throw fail(404,'Event not found');res.status(204).end();});
