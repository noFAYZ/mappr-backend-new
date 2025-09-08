// Simple test script for account groups functionality
const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api/v1';

// Test data
const testUser = {
  email: 'test@example.com',
  password: 'TestPassword123!'
};

let authToken = '';

async function makeRequest(method, url, data = null, headers = {}) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${url}`,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(authToken && { 'Authorization': `Bearer ${authToken}` })
      },
      ...(data && { data })
    };
    
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`Error in ${method} ${url}:`, error.response?.data || error.message);
    throw error;
  }
}

async function testAccountGroups() {
  console.log('🧪 Testing Account Groups Feature\n');
  
  try {
    // Test 1: Create a test account group
    console.log('1. Creating account group...');
    const createGroupResponse = await makeRequest('POST', '/account-groups', {
      name: 'Test Group',
      description: 'A test group for organizing accounts',
      icon: '💼',
      color: '#3B82F6'
    });
    console.log('✅ Account group created:', createGroupResponse.data?.name);
    const groupId = createGroupResponse.data?.id;
    
    // Test 2: Get all account groups
    console.log('\n2. Fetching all account groups...');
    const allGroupsResponse = await makeRequest('GET', '/account-groups');
    console.log('✅ Found', allGroupsResponse.data?.length, 'account group(s)');
    
    // Test 3: Get account group by ID
    console.log('\n3. Fetching account group by ID...');
    const groupResponse = await makeRequest('GET', `/account-groups/${groupId}`);
    console.log('✅ Retrieved group:', groupResponse.data?.name);
    
    // Test 4: Update account group
    console.log('\n4. Updating account group...');
    const updateResponse = await makeRequest('PUT', `/account-groups/${groupId}`, {
      name: 'Updated Test Group',
      description: 'Updated description'
    });
    console.log('✅ Updated group name to:', updateResponse.data?.name);
    
    // Test 5: Create default groups
    console.log('\n5. Creating default account groups...');
    const defaultsResponse = await makeRequest('POST', '/account-groups/defaults');
    console.log('✅ Created', defaultsResponse.data?.length, 'default groups');
    
    // Test 6: Get hierarchy
    console.log('\n6. Fetching account group hierarchy...');
    const hierarchyResponse = await makeRequest('GET', '/account-groups/hierarchy');
    console.log('✅ Retrieved hierarchy with', hierarchyResponse.data?.length, 'top-level groups');
    
    // Test 7: Delete test group
    console.log('\n7. Deleting test account group...');
    await makeRequest('DELETE', `/account-groups/${groupId}`);
    console.log('✅ Test group deleted successfully');
    
    console.log('\n🎉 All account groups tests passed!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  }
}

// We'll need to authenticate first, but for now let's just test if the endpoints respond
// In a real scenario, you'd need a valid auth token
testAccountGroups().then(() => {
  console.log('\n✨ Test complete');
}).catch(error => {
  console.error('\n💥 Test suite failed:', error.message);
});