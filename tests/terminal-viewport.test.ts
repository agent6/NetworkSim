import {test} from 'node:test';
import assert from 'node:assert/strict';
import {terminalPage,terminalRows} from '../src/ios-terminal.ts';

const output=Array.from({length:40},(_,index)=>`Line ${index+1}`);
test('console pages reserve visible rows for the command and More prompt',()=>{
  const first=terminalPage(output,{columns:80,rows:10,length:24,reservedRows:2});
  assert.deepEqual(first.visible,output.slice(0,8));
  const next=terminalPage(first.pending,{columns:80,rows:10,length:24});
  assert.deepEqual(next.visible,output.slice(8,17));
  assert.deepEqual([...first.visible,...next.visible,...next.pending],output);
});
test('an explicit smaller terminal length is retained and length zero disables the pager',()=>{
  assert.equal(terminalPage(output,{columns:80,rows:20,length:3}).visible.length,3);
  assert.deepEqual(terminalPage(['long unwrapped output',...output],{columns:4,rows:3,length:0}),{visible:['long unwrapped output',...output],pending:[]});
});
test('wrapped output and blank lines consume real screen rows without losing text',()=>{
  const lines=['1234567890','','abcdefghij'];
  const first=terminalPage(lines,{columns:4,rows:5,length:24,reservedRows:2});
  assert.deepEqual(first.visible,['1234','5678','90']);
  assert.deepEqual(first.pending,['','abcd','efgh','ij']);
  assert.deepEqual(lines,['1234567890','','abcdefghij']);
});
test('shrinking a page returns overflow before unread output and each remaining row appears once',()=>{
  const first=terminalPage(output,{columns:80,rows:15,length:24,reservedRows:2});
  const resized=terminalPage(first.visible,{columns:80,rows:5,length:24,reservedRows:2});
  let remaining=[...resized.pending,...first.pending];const displayed=[...resized.visible];
  while(remaining.length){const next=terminalPage(remaining,{columns:80,rows:5,length:24});displayed.push(...next.visible);remaining=next.pending;}
  assert.deepEqual(displayed,output);
});
test('tiny consoles still make progress and narrow columns page physical rows',()=>{
  const lines=terminalRows(['01234567890123456789','last'],20);
  const page=terminalPage(lines,{columns:5,rows:2,length:24,reservedRows:3});
  assert.deepEqual(page.visible,['01234']);
  assert.deepEqual(page.pending,['56789','01234','56789','last']);
});
