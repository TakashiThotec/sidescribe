const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'src', 'modules', 'hls-downloader.ts');
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
  Buffer,
  console,
};
vm.runInNewContext(compiled.outputText, context, { filename: sourcePath });
const hls = { ...context.exports, ...context.module.exports };

const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720
mid/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080
hi/index.m3u8?token=abc
`;

const variant = hls.selectBestVariantPlaylist(master, 'https://cdn.example.com/video/master.m3u8?auth=1');
assert.equal(variant, 'https://cdn.example.com/video/hi/index.m3u8?token=abc');

const media = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
seg-001.ts
#EXTINF:6.0,
https://other.example.com/seg-002.ts?x=1
#EXT-X-ENDLIST
`;

assert.equal(
  JSON.stringify(hls.parseSegmentUrls(media, 'https://cdn.example.com/video/hi/index.m3u8')),
  JSON.stringify([
    'https://cdn.example.com/video/hi/seg-001.ts',
    'https://other.example.com/seg-002.ts?x=1',
  ])
);

assert.equal(hls.selectBestVariantPlaylist(media, 'https://cdn.example.com/video/hi/index.m3u8'), null);

assert.equal(
  JSON.stringify(hls.classifyPlaylistSupport(media, 'https://cdn.example.com/video/hi/index.m3u8')),
  JSON.stringify({ supported: true, reason: 'DL可能', segmentCount: 2, encrypted: false })
);

assert.equal(
  JSON.stringify(hls.classifyPlaylistSupport('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nseg.ts', 'https://cdn.example.com/video/hi/index.m3u8')),
  JSON.stringify({ supported: true, reason: 'DL可能 (AES-128)', segmentCount: 1, encrypted: true })
);

assert.equal(
  JSON.stringify(hls.classifyPlaylistSupport('#EXTM3U\n#EXT-X-ENDLIST', 'https://cdn.example.com/video/hi/index.m3u8')),
  JSON.stringify({ supported: false, reason: '動画セグメントが見つかりません', segmentCount: 0, encrypted: false })
);

const encryptedMedia = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin",IV=0x00000000000000000000000000000009
#EXTINF:6.0,
seg-001.ts
#EXTINF:6.0,
seg-002.ts
`;

assert.equal(
  JSON.stringify(hls.parseEncryptionKey(encryptedMedia, 'https://cdn.example.com/video/hi/index.m3u8')),
  JSON.stringify({
    method: 'AES-128',
    uri: 'https://cdn.example.com/video/hi/keys/key.bin',
    ivHex: '00000000000000000000000000000009',
    mediaSequence: 0,
  })
);

assert.equal(
  hls.getSegmentIvHex(hls.parseEncryptionKey(encryptedMedia, 'https://cdn.example.com/video/hi/index.m3u8'), 0),
  '00000000000000000000000000000009'
);

assert.equal(
  hls.getSegmentIvHex({ method: 'AES-128', uri: 'https://cdn.example.com/key.bin' }, 1),
  '00000000000000000000000000000001'
);

assert.equal(
  hls.createDownloadFilename('2026年06月06日 制限解除版 激裏AIの作り方 | GUILD ACADEMY'),
  '2026年06月06日 制限解除版 激裏AIの作り方 GUILD ACADEMY.ts'
);
assert.equal(hls.createDownloadFilename(''), 'sidescribe-video.ts');

const akamaiExpiry = hls.describeHlsUrlExpiry(
  'https://vod-akm.play.hotmart.com/video/id/hls/master.m3u8?hdnts=st%3D1781948093%7Eexp%3D1781948593%7Ehmac%3Dabc',
  1781948000000
);
assert.equal(akamaiExpiry.expiresAtMs, 1781948593000);
assert.equal(akamaiExpiry.state, 'valid');

const cloudFrontPolicy = Buffer.from(JSON.stringify({
  Statement: [{
    Resource: 'https://contentplayer.hotmart.com/video/id/hls/*',
    Condition: { DateLessThan: { 'AWS:EpochTime': 1781951747 } },
  }],
}), 'utf8').toString('base64').replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');
const cloudFrontExpiry = hls.describeHlsUrlExpiry(
  `https://contentplayer.hotmart.com/video/id/hls/master.m3u8?Policy=${cloudFrontPolicy}`,
  1781951650000
);
assert.equal(cloudFrontExpiry.expiresAtMs, 1781951747000);
assert.equal(cloudFrontExpiry.state, 'expiring');

console.log('hls-downloader tests passed');
