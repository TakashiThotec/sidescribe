const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const downloaderPath = path.join(__dirname, '..', 'src', 'modules', 'hls-downloader.ts');
const snifferPath = path.join(__dirname, '..', 'src', 'modules', 'hls-sniffer.ts');

function loadModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const context = {
    exports: {},
    module: { exports: {} },
    require: (request) => {
      if (request === './hls-downloader') {
        return loadModule(downloaderPath);
      }
      return require(request);
    },
    URL,
    Buffer,
    console,
  };

  vm.runInNewContext(compiled.outputText, context, { filename: filePath });
  return { ...context.exports, ...context.module.exports };
}

const sniffer = loadModule(snifferPath);

assert.equal(sniffer.classifyHlsDeliveryMode('https://vod-akm.play.hotmart.com/video/id/hls/master.m3u8'), 'capture-preferred');
assert.equal(sniffer.classifyHlsDeliveryMode('https://contentplayer.hotmart.com/video/id/hls/master.m3u8'), 'direct');
assert.equal(sniffer.extractVideoPathKey('https://vod-akm.play.hotmart.com/video/pRQByYk7qB/hls/master.m3u8'), 'pRQByYk7qB');

const mediaPlaylist = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
seg-001.ts
#EXTINF:6.0,
seg-002.ts
#EXT-X-ENDLIST
`;
const playlists = new Map([
  ['https://vod-akm.play.hotmart.com/video/pRQByYk7qB/hls/1080p/index.m3u8?hdnts=abc', mediaPlaylist],
]);
const segmentBuffers = new Map([
  [sniffer.segmentPathKey('https://vod-akm.play.hotmart.com/video/pRQByYk7qB/hls/1080p/seg-001.ts?hdnts=1'), new ArrayBuffer(8)],
  [sniffer.segmentPathKey('https://vod-akm.play.hotmart.com/video/pRQByYk7qB/hls/1080p/seg-002.ts?hdnts=2'), new ArrayBuffer(8)],
]);

const streamUrl = 'https://vod-akm.play.hotmart.com/video/pRQByYk7qB/hls/master.m3u8?hdnts=master';
const progress = sniffer.computeCaptureProgress(streamUrl, playlists, segmentBuffers);
assert.equal(progress.total, 2);
assert.equal(progress.captured, 2);
assert.equal(progress.ready, true);

const resolved = sniffer.resolveCaptureSegmentBuffers(streamUrl, playlists, segmentBuffers);
assert.equal(resolved?.buffers.length, 2);

console.log('hls-sniffer tests passed');
