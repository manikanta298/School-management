import test from 'node:test';
import assert from 'node:assert/strict';
import {attendanceAnalysis,publicationAnalysis,overdueAnalysis} from '../src/components/analytics.js';
test('attendance uses only recorded categories, including excused, and does not invent absences',()=>{
 const result=attendanceAnalysis({present:80,late:5,absent:10,excused:5,recorded:100});
 assert.equal(result.total,100);assert.equal(result.percent,85);assert.equal(result.segments.length,4);
 assert.equal(attendanceAnalysis({present:0,late:0,absent:0,excused:0,recorded:0}).percent,null);
});
test('publication percentage has a meaningful denominator and handles an empty school',()=>{
 assert.deepEqual(publicationAnalysis({published:3,draft:1}),{published:3,draft:1,total:4,percent:75});
 assert.equal(publicationAnalysis({published:0,draft:0}).percent,null);
});
test('overdue share preserves large minor-unit amounts and never divides by zero',()=>{
 assert.equal(overdueAnalysis({outstanding_minor:'100000000000000000000',overdue_minor:'25000000000000000000'}),25);
 assert.equal(overdueAnalysis({outstanding_minor:'300',overdue_minor:'100'}),33.33);
 assert.equal(overdueAnalysis({outstanding_minor:'100',overdue_minor:'0'}),0);
 assert.equal(overdueAnalysis({outstanding_minor:'0',overdue_minor:'0'}),null);
});
