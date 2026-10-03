import test from 'node:test';
import assert from 'node:assert/strict';
import {tags,tagCategory,tagOptions} from '../public/tags.js';
import {validateDays} from '../server/api.js';
import {seedDays} from '../public/seed.js';

test('new and earlier labels select stable categories, arbitrary labels remain neutral',()=>{
 for(const {label,id} of tags)assert.equal(tagCategory(label),id);
 assert.equal(tagCategory('固定演唱會'),'concert');
 assert.equal(tagCategory('甜點'),'cafe');
 assert.equal(tagCategory('<script>'),'other');
 assert.equal(tagOptions('我的收藏')[0],'我的收藏');
 assert.equal(tagOptions('演唱會').filter(value=>value==='演唱會').length,1);
});
test('saving tag changes preserves fixed concerts, times and stay durations',()=>{
 const days=structuredClone(seedDays);
 days[2].stops.at(-1).tag='演唱會';
 days[2].stops.at(-1).duration=120;
 const saved=validateDays(days)[2].stops.at(-1);
 assert.equal(saved.tag,'演唱會');
 assert.equal(saved.live,true);
 assert.equal(saved.time,seedDays[2].stops.at(-1).time);
 assert.equal(saved.duration,120);
});
