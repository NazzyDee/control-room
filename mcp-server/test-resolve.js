import { db } from './db.js';
import { getUnresolvedMessages, getMessageDetails, resolveMessage } from './services/messages.js';

async function testResolutionFlow() {
  console.log('🧪 Testing Message Creation, Query, and Resolution Flow...\n');

  // 1. Create a temporary test unresolved message
  const testDoc = await db.collection('feedback').add({
    app: 'PlexMePlease',
    user: 'tester@example.com',
    type: 'bug',
    priority: 'high',
    status: 'unresolved',
    title: 'MCP Server Automated Test Ticket',
    message: 'This is a temporary test message to verify the MCP resolve tool.',
    createdAt: new Date()
  });

  const testId = testDoc.id;
  console.log(`Created test unresolved feedback item with ID: ${testId}`);

  try {
    // 2. Verify it appears in getUnresolvedMessages
    const unresolved = await getUnresolvedMessages({ limit: 10, priority: 'high', app: 'PlexMePlease' });
    const found = unresolved.messages.find(m => m.message_id === testId);
    if (!found) {
      throw new Error(`Test message ${testId} was not found in unresolved list!`);
    }
    console.log('✓ Found test message in getUnresolvedMessages:', found.subject);

    // 3. Verify getMessageDetails
    const details = await getMessageDetails(testId);
    console.log('✓ Retrieved message details:', {
      id: details.message_id,
      sender: details.sender,
      status: details.status,
      priority: details.priority
    });

    // 4. Resolve the message
    const resolutionResult = await resolveMessage(testId, 'Resolved by MCP automated integration test');
    console.log('✓ Resolved message via resolveMessage:', resolutionResult);

    // 5. Verify it is now resolved
    const updatedDetails = await getMessageDetails(testId);
    if (updatedDetails.status !== 'resolved' || updatedDetails.resolutionNotes !== 'Resolved by MCP automated integration test') {
      throw new Error('Resolution details did not update as expected!');
    }
    console.log('✓ Successfully verified updated status and resolution notes:', updatedDetails.status, updatedDetails.resolutionNotes);

    // 6. Verify it is no longer in getUnresolvedMessages
    const afterUnresolved = await getUnresolvedMessages({ limit: 10 });
    const stillPresent = afterUnresolved.messages.find(m => m.message_id === testId);
    if (stillPresent) {
      throw new Error('Resolved message still appears in getUnresolvedMessages!');
    }
    console.log('✓ Verified message is no longer returned in unresolved query.');

  } finally {
    // Cleanup temporary doc
    await db.collection('feedback').doc(testId).delete();
    console.log(`\n🧹 Cleaned up temporary test document ${testId}`);
  }

  console.log('\n🎉 Complete resolution workflow test passed!');
  process.exit(0);
}

testResolutionFlow().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
