import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,rowsFromCsv} from '../src/api/csv.js';
test('CSV parser handles quotes, embedded commas and line breaks, and CRLF',()=>{
 assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"line\nbreak",z\r\n'),[['a','b'],['x, y','say "hi"'],['line\nbreak','z']]);
});
test('rows omit empty cells, trim values, strip a BOM and skip blank lines',()=>{
 assert.deepEqual(rowsFromCsv('\uFEFFadmission_number, city ,gender\nADM1, Pune ,\n\nADM2,,female\n'),[{admission_number:'ADM1',city:'Pune'},{admission_number:'ADM2',gender:'female'}]);
 assert.deepEqual(rowsFromCsv(''),[]);
});
