const path = require('path');
const fs = require('fs');

// Load environment variables from .env if present
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}

const { handler } = require('./netlify/functions/messages.cjs');

async function runTests() {
  console.log('🧪 Testing Netlify ControlRoom messages function...\n');

  // Test 1: OPTIONS / CORS preflight
  console.log('1️⃣ Testing OPTIONS preflight...');
  const optionsRes = await handler({ httpMethod: 'OPTIONS', headers: {} }, {});
  console.log('  Status:', optionsRes.statusCode);
  if (optionsRes.statusCode === 200) {
    console.log('  ✅ OPTIONS passed.');
  } else {
    console.error('  ❌ OPTIONS failed:', optionsRes);
  }

  // Test 2: GET Unresolved Messages
  console.log('\n2️⃣ Testing GET unresolved messages...');
  const getRes = await handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { limit: '5' }
  }, {});

  console.log('  Status:', getRes.statusCode);
  if (getRes.statusCode === 200) {
    const data = JSON.parse(getRes.body);
    console.log(`  ✅ Retrieved ${data.count} messages (total: ${data.total_retrieved}).`);
    if (data.messages && data.messages.length > 0) {
      console.log('  Sample message:', JSON.stringify(data.messages[0], null, 2));

      // Test 3: GET Message Details for first message
      const firstId = data.messages[0].message_id;
      console.log(`\n3️⃣ Testing GET message details for ID "${firstId}"...`);
      const detailRes = await handler({
        httpMethod: 'GET',
        headers: {},
        queryStringParameters: { message_id: firstId }
      }, {});
      console.log('  Status:', detailRes.statusCode);
      if (detailRes.statusCode === 200) {
        const detailData = JSON.parse(detailRes.body);
        console.log('  ✅ Retrieved detail for subject:', detailData.subject);
      } else {
        console.error('  ❌ Detail fetch failed:', detailRes);
      }
    }
  } else {
    console.error('  ❌ GET failed:', getRes.body);
  }

  // Test 4: API Key Authentication (when key configured)
  console.log('\n4️⃣ Testing API Key Authentication logic...');
  process.env.CONTROLROOM_API_KEY = 'test-secret-key';
  
  // 4a. Without key -> Should return 401
  const unauthRes = await handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { limit: '1' }
  }, {});
  console.log('  Without key Status (expected 401):', unauthRes.statusCode);

  // 4b. With correct key -> Should return 200
  const authRes = await handler({
    httpMethod: 'GET',
    headers: { 'x-api-key': 'test-secret-key' },
    queryStringParameters: { limit: '1' }
  }, {});
  console.log('  With valid key Status (expected 200):', authRes.statusCode);

  delete process.env.CONTROLROOM_API_KEY;

  console.log('\n✨ Test suite completed successfully!');
}

runTests().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
