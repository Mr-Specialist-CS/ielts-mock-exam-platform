import { onRequest } from './functions/api/[[catchall]]';
import { D1Storage } from './src/server/storage';

async function testNoSilentFallback() {
  console.log('--- TESTING NO SILENT FALLBACK TO MEMORY IN PRODUCTION ---');

  // Test 1: Production request with missing env.DB
  const fakeContextProd = {
    request: new Request('http://localhost/api/exams', { method: 'GET' }),
    env: {
      ENVIRONMENT: 'production' // Production flag without DB binding
    },
    params: {}
  };

  const resProd = await onRequest(fakeContextProd);
  const dataProd = await resProd.json();

  console.log('Test 1 (Production without DB binding):');
  console.log('Status code:', resProd.status);
  console.log('Returned error:', dataProd.error);
  console.log('Returned message:', dataProd.message);

  if (resProd.status === 503 && dataProd.error === 'Cloudflare D1 Database Not Configured') {
    console.log('-> PASS: Production refused to silently fall back to memory!');
  } else {
    console.error('-> FAIL: Production should have returned 503 with configuration error.');
    process.exit(1);
  }

  // Test 2: D1Storage error behavior (no silent fallback)
  const brokenD1 = {
    prepare: () => {
      throw new Error('D1 table corrupted or disconnected');
    }
  };
  const d1Storage = new D1Storage(brokenD1 as any);

  let thrown = false;
  try {
    await d1Storage.getExams();
  } catch (err: any) {
    thrown = true;
    console.log('\nTest 2 (D1 database failure handling):');
    console.log('Caught error:', err.message);
    if (err.message.includes('[Cloudflare D1 Error]')) {
      console.log('-> PASS: D1Storage explicitly threw the database error instead of falling back to memory!');
    } else {
      console.error('-> FAIL: Error message did not include D1 error context.');
      process.exit(1);
    }
  }

  if (!thrown) {
    console.error('-> FAIL: D1Storage should have thrown an error on broken D1!');
    process.exit(1);
  }

  console.log('\nALL STRICT D1 ERROR CHECKS PASSED!');
}

testNoSilentFallback().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
