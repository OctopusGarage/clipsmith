import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
const exec = promisify(execFile);

async function capture(html, inspect, headers = {}, options = {}) {
  const server = createServer((_req, res) => {
    if (options.resolveChallenge && _req.url === '/destination') {
      setTimeout(() => {res.writeHead(200, {'content-type':'text/html'});
        res.end('<title>Verified article</title><main>'+'Verified article body. '.repeat(40)+'</main>');}, 500);
      return;
    }
    if (options.resolveChallenge && _req.url === '/verified') {
      if (options.redirectChallenge) {res.writeHead(302, {location:'/destination'});res.end();return;}
      res.writeHead(200, {'content-type':'text/html'});
      res.end('<title>Verified article</title><main>'+'Verified article body. '.repeat(40)+'</main>');
      return;
    }
    res.writeHead(headers['cf-mitigated'] ? 403 : 200, { 'content-type': 'text/html', ...headers });
    res.end(options.requireCookie && !_req.headers.cookie?.includes('session=existing') ? 'Missing browser session' : html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const output = await mkdtemp(join(tmpdir(), 'clipsmith-web-test-'));
  try {
    const url = `http://127.0.0.1:${server.address().port}/article`;
    await inspect((args) => exec('npx', args || ['tsx', 'scripts/run.ts', '--url', url, '--output_dir', output],
      { cwd: new URL('..', import.meta.url).pathname.replace(/\/tests\/$/, '/'), timeout: 30000, env: {...process.env, CLIPSMITH_WEB_CDP_URL: options.cdpUrl || '', CLIPSMITH_WEB_BROWSER_CONFIG: join(output, 'browser.json')} }), {url,output});
  } finally { server.close(); await rm(output, {recursive:true, force:true}); }
}

test('article body survives a related-links sidebar before the body', async () => {
  const body = 'A meaningful paragraph about evaluation systems. '.repeat(20);
  await capture(`<title>Example</title><main><article><aside>Related articles</aside>
    <div data-article-body="true"><p>${body}</p><h2>Final section</h2><p>Last important detail.</p></div>
    <footer>Footer noise</footer></article></main>`, async run => {
      const {stdout} = await run(); const dir = JSON.parse(stdout).bundle_dir;
      const post = await readFile(join(dir,'post.md'),'utf8');
      assert.ok(post.includes(body.trim()), 'full article paragraph is preserved');
      assert.ok(post.includes('Final section'));
      assert.ok(post.includes('Last important detail.'));
      assert.ok(!post.includes('Footer noise'));
      assert.ok(!post.includes('Related articles'));
      const summary = await readFile(join(dir,'summary.md'),'utf8');
      assert.ok(summary.trim().endsWith('systems.'), 'summary excerpt ends at a complete sentence');
    });
});

test('short fragments are partial rather than complete', async () => {
  await capture('<title>Example</title><main><p>Only a fragment.</p></main>', async run => {
    const {stdout} = await run(); const dir = JSON.parse(stdout).bundle_dir;
    const meta = JSON.parse(await readFile(join(dir,'capture.json'),'utf8'));
    assert.equal(meta.status, 'partial');
  });
});

test('headless challenge requests a normal browser check instead of claiming human-only access', async () => {
  await capture('', async run => {
    await assert.rejects(run, error => error.stderr.includes('Headless browser verification challenge'));
  }, {'cf-mitigated':'challenge'});
});

test('an article mentioning Cloudflare is not a verification page', async () => {
  await capture(`<title>Infrastructure</title><main><div data-article-body="true"><p>${
    'Our infrastructure integrates Cloudflare for service delivery. '.repeat(20)
  }</p></div></main>`, async run => {
    const {stdout} = await run(); const dir = JSON.parse(stdout).bundle_dir;
    const meta = JSON.parse(await readFile(join(dir,'capture.json'),'utf8'));
    assert.equal(meta.status, 'complete');
  });
});


test('CDP capture reuses the existing browser context and preserves other tabs', async () => {
  const portServer = createServer();
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const profile = await mkdtemp(join(tmpdir(), 'clipsmith-cdp-test-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, args: [`--remote-debugging-port=${port}`],
  });
  const keep = context.pages()[0];
  await keep.goto('data:text/html,<title>Keep this tab</title>');
  await context.addCookies([{name:'session',value:'existing',domain:'127.0.0.1',path:'/'}]);
  try {
    await capture(`<title>Session article</title><main>${'Full article content. '.repeat(40)}<article><header><h2><a href='/post/one'>A useful article</a></h2></header></article></main><footer><a href='/post/navigation'>Footer navigation link</a></footer>`, async (run, {url}) => {
      const endpoint = `http://127.0.0.1:${port}`;
      await run(['tsx','scripts/browser.ts','set',endpoint]);
      const config = JSON.parse((await run(['tsx','scripts/browser.ts','get'])).stdout);
      assert.equal(config.cdp_url, endpoint);
      const {stdout} = await run(); const dir = JSON.parse(stdout).bundle_dir;
      const meta = JSON.parse(await readFile(join(dir,'capture.json'),'utf8'));
      assert.equal(meta.status, 'complete');
      assert.equal(keep.isClosed(), false);
      assert.equal(await keep.title(), 'Keep this tab');
      assert.equal(context.pages().length, 1, 'capture tab is closed');
      const discovery = JSON.parse((await run(['tsx','scripts/discover.ts',url,'/post/'])).stdout);
      assert.equal(discovery.items.length, 1, 'footer navigation is excluded from discovery');
      assert.equal(discovery.items[0].title, 'A useful article');
      assert.equal(context.pages().length, 1, 'discovery tab is closed');
      await capture('', async challengeRun => {
        await assert.rejects(challengeRun, error => error.stderr.includes('tab left open for interaction'));
        assert.equal(context.pages().length, 2, 'verification page is retained for interaction');
        const verification = context.pages().find(page => page !== keep);
        await verification.close();
      }, {'cf-mitigated':'challenge'}, {cdpUrl:endpoint});
      await capture('<title>Verify</title><main>Verify you are human to continue.</main>', async challengeRun => {
        const {stdout} = await challengeRun();
        const meta = JSON.parse(await readFile(join(JSON.parse(stdout).bundle_dir,'capture.json'),'utf8'));
        assert.equal(meta.status, 'needs_manual_action');
        assert.equal(context.pages().length, 2, 'HTTP 200 verification page is retained');
        await context.pages().find(page => page !== keep).close();
      }, {}, {cdpUrl:endpoint});
      await capture('<script>setTimeout(() => { location.href="/verified"; }, 100)</script>', async verifiedRun => {
        const {stdout} = await verifiedRun();
        const dir = JSON.parse(stdout).bundle_dir;
        const meta = JSON.parse(await readFile(join(dir,'capture.json'),'utf8'));
        assert.equal(meta.status, 'complete', 'automatic verification is allowed to complete');
        assert.equal(context.pages().length, 1);
      }, {'cf-mitigated':'challenge'}, {cdpUrl:endpoint,resolveChallenge:true});
      await capture('<script>setTimeout(() => { location.href="/verified"; }, 100)</script>', async (navigationRun, {url}) => {
        const code = `import {openBrowserPage,navigateBrowser} from './scripts/browser.ts';
          (async()=>{const session=await openBrowserPage();try{
            const response=await navigateBrowser(session,${JSON.stringify(url)});
            console.log(JSON.stringify({status:response.status(),title:await session.page.title()}));
          }finally{await session.close();}})();`;
        const result=JSON.parse((await navigationRun(['tsx','-e',code])).stdout);
        assert.equal(result.status,200,'redirect is not accepted as a final verified response');
        assert.equal(result.title,'Verified article','the verified document is committed and ready');
      }, {'cf-mitigated':'challenge'}, {cdpUrl:endpoint,resolveChallenge:true,redirectChallenge:true});
      await assert.rejects(() => run(['tsx','scripts/browser.ts','set','http://remote.example:9222']), /loopback/);
      await run(['tsx','scripts/browser.ts','reset']);
      assert.equal(JSON.parse((await run(['tsx','scripts/browser.ts','get'])).stdout).mode,'headless');
    }, {}, {requireCookie:true});
  } finally { await context.close(); await rm(profile,{recursive:true,force:true}); }
});

test('TOC content container excludes article headers and link accessibility labels', async () => {
  const body = 'The substantive article body is preserved in order. '.repeat(20);
  await capture(`<title>Example</title><main><article><header>Header boilerplate</header>
    <nav>Jump to section</nav><div data-toc-content><p>${body}</p>
    <span>(opens in a new window)</span><h2>Final section</h2></div></article></main>`, async run => {
      const {stdout} = await run(); const dir = JSON.parse(stdout).bundle_dir;
      const post = await readFile(join(dir,'post.md'),'utf8');
      assert.ok(post.includes(body.trim()));
      assert.ok(!post.includes('Header boilerplate'));
      assert.ok(!post.includes('Jump to section'));
      assert.ok(!post.includes('(opens in a new window)'));
    });
});
