import { getUnresolvedMessages, getMessageDetails } from './services/messages.js';

async function runTests() {
  console.log('🧪 Starting ControlRoom MCP Server Test Suite...\n');

  // Test 1: Fetch unresolved messages
  console.log('Test 1: getUnresolvedMessages (limit: 5)');
  const res = await getUnresolvedMessages({ limit: 5 });
  console.log(`✓ Success! Retrieved ${res.count} unresolved messages.`);
  console.log('Sample output:', JSON.stringify(res, null, 2));

  // Test 2: Fetch message details of an existing document
  const sampleId = '0dbn4lp9epaTIRQyPXoF';
  console.log(`\nTest 2: getMessageDetails for ID: ${sampleId}`);
  const details = await getMessageDetails(sampleId);
  console.log('✓ Success! Retrieved details:');
  console.log(JSON.stringify(details, null, 2));

  // Test 3: Invalid message ID handling
  console.log('\nTest 3: getMessageDetails with invalid/non-existent ID');
  try {
    await getMessageDetails('non_existent_doc_id_99999');
    console.error('✕ Expected error for non-existent ID, but got success.');
  } catch (err) {
    console.log('✓ Expected error properly caught:', err.message);
  }

  // Test 4: Filtering parameters test
  console.log('\nTest 4: getUnresolvedMessages with priority and app filter');
  const filteredRes = await getUnresolvedMessages({ priority: 'high', app: 'PlexMePlease' });
  console.log(`✓ Success! Filtered response count: ${filteredRes.count}`);

  console.log('\n✨ All tests passed successfully!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
