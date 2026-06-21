const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'src', 'background', 'hls-detector.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const context = {
  exports: {},
  module: { exports: {} },
  require,
  URL,
  console,
};
vm.runInNewContext(compiled.outputText, context, { filename: sourcePath });
const detector = { ...context.exports, ...context.module.exports };

assert.equal(detector.isM3u8Url('https://cdn.example.com/video/master.m3u8'), true);
assert.equal(detector.isM3u8Url('https://cdn.example.com/video/master.m3u8?token=abc'), true);
assert.equal(detector.isM3u8Url('https://cdn.example.com/video/segment.ts'), false);

assert.equal(
  detector.isUrlAllowedByPatterns('https://learn.hotmart.com/course/123', ['https://learn.hotmart.com/*']),
  true
);
assert.equal(
  detector.isUrlAllowedByPatterns('https://video.hotmart.com/embed/abc', ['https://*.hotmart.com/*']),
  true
);
assert.equal(
  detector.isUrlAllowedByPatterns('https://evil.example.com/watch', ['https://*.hotmart.com/*']),
  false
);
assert.equal(
  detector.isUrlAllowedByPatterns('not a url', ['https://*.hotmart.com/*']),
  false
);

const detected = detector.createDetectedHlsStream({
  requestUrl: 'https://cdn.hotmart.com/path/master.m3u8?token=secret',
  pageUrl: 'https://learn.hotmart.com/course/123',
  pageTitle: 'Lesson 01',
  tabId: 42,
  frameId: 7,
  frameUrl: 'https://player.hotmart.com/embed/abc',
  initiator: 'https://player.hotmart.com',
  detectedAt: 1760000000000,
});

assert.equal(detected.id, '42:https://cdn.hotmart.com/path/master.m3u8');
assert.equal(detected.url, 'https://cdn.hotmart.com/path/master.m3u8?token=secret');
assert.equal(detected.pageTitle, 'Lesson 01');
assert.equal(detected.hostname, 'learn.hotmart.com');
assert.equal(detected.frameId, 7);
assert.equal(detected.frameUrl, 'https://player.hotmart.com/embed/abc');
assert.equal(detected.initiator, 'https://player.hotmart.com');

assert.equal(detector.isMissingTabError(new Error('No tab with id: 1291306142.')), true);
assert.equal(detector.isMissingTabError(new Error('Tabs cannot be edited right now.')), false);
assert.equal(detector.isMissingTabError('No tab with id: 1291306142.'), false);

console.log('hls-detector tests passed');
