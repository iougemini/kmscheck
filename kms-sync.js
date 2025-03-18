const fetch = require('node-fetch');
const Cloudflare = require('cloudflare');
const net = require('net');

// 从 Issues 页面抓取 KMS 服务器地址
async function getKmsServersFromIssue(issueUrl) {
  try {
    console.log(`Fetching KMS servers from issue: ${issueUrl}`);
    const response = await fetch(issueUrl);
    const text = await response.text();
    
    // 输出部分内容用于调试
    console.log('Issue content preview:', text.substring(0, 500) + '...');

    // 使用正则表达式提取 KMS 服务器地址
    const regex = /(?:kms|KMS)\s*:\s*([a-zA-Z0-9.-]+:\d+)/g;
    let match;
    const servers = [];
    while ((match = regex.exec(text)) !== null) {
      servers.push(match[1]);
      console.log(`Found KMS server: ${match[1]}`);
    }
    
    if (servers.length === 0) {
      console.warn('No KMS servers found in the issue content. Check the regex pattern.');
    }
    
    return servers;
  } catch (error) {
    console.error('Error fetching KMS servers from issue:', error);
    return [];
  }
}

// 使用TCP连接测试KMS服务器可达性
async function testKmsServer(serverAddress) {
  return new Promise((resolve) => {
    const [hostname, port] = serverAddress.split(':');
    console.log(`Testing KMS server: ${hostname}:${port}`);
    
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      console.error(`KMS server ${serverAddress} connection timeout`);
      resolve(false);
    }, 5000);

    socket.connect(parseInt(port, 10), hostname, () => {
      clearTimeout(timeout);
      console.log(`KMS server ${serverAddress} is valid`);
      socket.destroy();
      resolve(true);
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      console.error(`KMS server ${serverAddress} connection failed:`, error.message);
      resolve(false);
    });
  });
}

// 更新 Cloudflare DNS 记录
async function updateCloudflareDnsRecord(apiToken, zoneId, recordName, recordValue) {
  console.log(`Updating DNS record ${recordName} to ${recordValue}`);
  console.log(`Using Zone ID: ${zoneId}`);
  
  // 确定是使用API令牌还是全局API密钥
  let cf;
  if (apiToken.includes(':')) {
    console.log('Using Global API Key');
    const [email, key] = apiToken.split(':');
    cf = new Cloudflare({
      email: email,
      key: key
    });
  } else {
    console.log('Using API Token');
    cf = new Cloudflare({ token: apiToken });
  }

  try {
    // 检查API令牌是否有效
    console.log('Verifying Cloudflare API credentials...');
    try {
      const user = await cf.user.read();
      console.log(`API credentials are valid. User: ${user.result.email}`);
    } catch (error) {
      console.error('API credentials verification failed:', error);
      return;
    }

    // 获取区域信息
    console.log(`Getting zone information for zone ID: ${zoneId}`);
    const zones = await cf.zones.browse();
    const zone = zones.result.find(z => z.id === zoneId);

    if (!zone) {
      console.error(`Zone with ID ${zoneId} not found.`);
      console.log('Available zones:', zones.result.map(z => ({ id: z.id, name: z.name })));
      return;
    }
    
    console.log(`Found zone: ${zone.name}`);

    // 获取DNS记录
    console.log(`Looking for DNS record: ${recordName}`);
    const dnsRecords = await cf.dnsRecords.browse(zoneId);
    console.log(`Found ${dnsRecords.result.length} DNS records in zone.`);
    
    // 尝试完全匹配和子域名匹配
    let existingRecord = dnsRecords.result.find(record => record.name === recordName && record.type === 'A');
    
    // 如果找不到完全匹配，可能是因为Cloudflare自动添加了域名
    if (!existingRecord) {
      const domainName = zone.name;
      const possibleNames = [
        recordName,
        `${recordName}.${domainName}`,
        recordName.replace(`.${domainName}`, '')
      ];
      
      console.log(`Trying alternative record names: ${possibleNames.join(', ')}`);
      
      for (const name of possibleNames) {
        existingRecord = dnsRecords.result.find(record => record.name === name && record.type === 'A');
        if (existingRecord) {
          console.log(`Found record with name: ${name}`);
          break;
        }
      }
    }

    if (existingRecord) {
      console.log(`Found existing DNS record: ${JSON.stringify(existingRecord)}`);
      await cf.dnsRecords.edit(zoneId, existingRecord.id, {
        type: 'A',
        name: existingRecord.name, // 使用找到的记录名称
        content: recordValue,
        ttl: 3600,
      });
      console.log(`DNS record ${existingRecord.name} updated to ${recordValue}`);
    } else {
      console.log(`No existing record found for ${recordName}, creating new record`);
      await cf.dnsRecords.add(zoneId, {
        type: 'A',
        name: recordName,
        content: recordValue,
        ttl: 3600,
      });
      console.log(`DNS record ${recordName} created with value ${recordValue}`);
    }
  } catch (error) {
    console.error('Error updating Cloudflare DNS record:', error);
    // 打印更详细的错误信息
    if (error.response) {
      console.error('Error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        body: error.response.body
      });
    }
  }
}

async function main() {
  const issueUrl = 'https://github.com/iougemini/iougemini.github.io/issues/1';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const recordName = process.env.DNS_RECORD_NAME;
  
  // 验证环境变量
  if (!apiToken) {
    console.error('CLOUDFLARE_API_TOKEN environment variable is not set');
    process.exit(1);
  }
  
  if (!zoneId) {
    console.error('CLOUDFLARE_ZONE_ID environment variable is not set');
    process.exit(1);
  }
  
  if (!recordName) {
    console.error('DNS_RECORD_NAME environment variable is not set');
    process.exit(1);
  }
  
  console.log(`Starting KMS server sync process`);
  console.log(`DNS record name: ${recordName}`);

  // 1. 抓取 KMS 服务器地址
  const kmsServers = await getKmsServersFromIssue(issueUrl);
  console.log('Found KMS servers:', kmsServers);

  // 2. 测试 KMS 服务器连接，筛选有效的服务器
  const validKmsServers = [];
  for (const server of kmsServers) {
    const isValid = await testKmsServer(server);
    if (isValid) {
      validKmsServers.push(server);
    }
  }
  console.log('Valid KMS servers:', validKmsServers);

  // 3. 选择一个有效的 KMS 服务器 (例如，选择第一个)
  if (validKmsServers.length > 0) {
    const selectedServer = validKmsServers[0].split(':')[0]; // 提取 IP/域名
    console.log('Selected KMS server:', selectedServer);

    // 4. 更新 Cloudflare DNS 记录
    await updateCloudflareDnsRecord(apiToken, zoneId, recordName, selectedServer);
  } else {
    console.warn('No valid KMS servers found.');
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
const Cloudflare = require('cloudflare');
const net = require('net');

// 从 Issues 页面抓取 KMS 服务器地址
async function getKmsServersFromIssue(issueUrl) {
  try {
    console.log(`Fetching KMS servers from issue: ${issueUrl}`);
    const response = await fetch(issueUrl);
    const text = await response.text();
    
    // 输出部分内容用于调试
    console.log('Issue content preview:', text.substring(0, 500) + '...');

    // 使用正则表达式提取 KMS 服务器地址
    const regex = /(?:kms|KMS)\s*:\s*([a-zA-Z0-9.-]+:\d+)/g;
    let match;
    const servers = [];
    while ((match = regex.exec(text)) !== null) {
      servers.push(match[1]);
      console.log(`Found KMS server: ${match[1]}`);
    }
    
    if (servers.length === 0) {
      console.warn('No KMS servers found in the issue content. Check the regex pattern.');
    }
    
    return servers;
  } catch (error) {
    console.error('Error fetching KMS servers from issue:', error);
    return [];
  }
}

// 使用TCP连接测试KMS服务器可达性
async function testKmsServer(serverAddress) {
  return new Promise((resolve) => {
    const [hostname, port] = serverAddress.split(':');
    console.log(`Testing KMS server: ${hostname}:${port}`);
    
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      console.error(`KMS server ${serverAddress} connection timeout`);
      resolve(false);
    }, 5000);

    socket.connect(parseInt(port, 10), hostname, () => {
      clearTimeout(timeout);
      console.log(`KMS server ${serverAddress} is valid`);
      socket.destroy();
      resolve(true);
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      console.error(`KMS server ${serverAddress} connection failed:`, error.message);
      resolve(false);
    });
  });
}

// 更新 Cloudflare DNS 记录
async function updateCloudflareDnsRecord(apiToken, zoneId, recordName, recordValue) {
  console.log(`Updating DNS record ${recordName} to ${recordValue}`);
  console.log(`Using Zone ID: ${zoneId}`);
  
  // 确定是使用API令牌还是全局API密钥
  let cf;
  if (apiToken.includes(':')) {
    console.log('Using Global API Key');
    const [email, key] = apiToken.split(':');
    cf = new Cloudflare({
      email: email,
      key: key
    });
  } else {
    console.log('Using API Token');
    cf = new Cloudflare({ token: apiToken });
  }

  try {
    // 检查API令牌是否有效
    console.log('Verifying Cloudflare API credentials...');
    try {
      const user = await cf.user.read();
      console.log(`API credentials are valid. User: ${user.result.email}`);
    } catch (error) {
      console.error('API credentials verification failed:', error);
      return;
    }

    // 获取区域信息
    console.log(`Getting zone information for zone ID: ${zoneId}`);
    const zones = await cf.zones.browse();
    const zone = zones.result.find(z => z.id === zoneId);

    if (!zone) {
      console.error(`Zone with ID ${zoneId} not found.`);
      console.log('Available zones:', zones.result.map(z => ({ id: z.id, name: z.name })));
      return;
    }
    
    console.log(`Found zone: ${zone.name}`);

    // 获取DNS记录
    console.log(`Looking for DNS record: ${recordName}`);
    const dnsRecords = await cf.dnsRecords.browse(zoneId);
    console.log(`Found ${dnsRecords.result.length} DNS records in zone.`);
    
    // 尝试完全匹配和子域名匹配
    let existingRecord = dnsRecords.result.find(record => record.name === recordName && record.type === 'A');
    
    // 如果找不到完全匹配，可能是因为Cloudflare自动添加了域名
    if (!existingRecord) {
      const domainName = zone.name;
      const possibleNames = [
        recordName,
        `${recordName}.${domainName}`,
        recordName.replace(`.${domainName}`, '')
      ];
      
      console.log(`Trying alternative record names: ${possibleNames.join(', ')}`);
      
      for (const name of possibleNames) {
        existingRecord = dnsRecords.result.find(record => record.name === name && record.type === 'A');
        if (existingRecord) {
          console.log(`Found record with name: ${name}`);
          break;
        }
      }
    }

    if (existingRecord) {
      console.log(`Found existing DNS record: ${JSON.stringify(existingRecord)}`);
      await cf.dnsRecords.edit(zoneId, existingRecord.id, {
        type: 'A',
        name: existingRecord.name, // 使用找到的记录名称
        content: recordValue,
        ttl: 3600,
      });
      console.log(`DNS record ${existingRecord.name} updated to ${recordValue}`);
    } else {
      console.log(`No existing record found for ${recordName}, creating new record`);
      await cf.dnsRecords.add(zoneId, {
        type: 'A',
        name: recordName,
        content: recordValue,
        ttl: 3600,
      });
      console.log(`DNS record ${recordName} created with value ${recordValue}`);
    }
  } catch (error) {
    console.error('Error updating Cloudflare DNS record:', error);
    // 打印更详细的错误信息
    if (error.response) {
      console.error('Error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        body: error.response.body
      });
    }
  }
}

async function main() {
  const issueUrl = 'https://github.com/iougemini/iougemini.github.io/issues/1';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const recordName = process.env.DNS_RECORD_NAME;
  
  // 验证环境变量
  if (!apiToken) {
    console.error('CLOUDFLARE_API_TOKEN environment variable is not set');
    process.exit(1);
  }
  
  if (!zoneId) {
    console.error('CLOUDFLARE_ZONE_ID environment variable is not set');
    process.exit(1);
  }
  
  if (!recordName) {
    console.error('DNS_RECORD_NAME environment variable is not set');
    process.exit(1);
  }
  
  console.log(`Starting KMS server sync process`);
  console.log(`DNS record name: ${recordName}`);

  // 1. 抓取 KMS 服务器地址
  const kmsServers = await getKmsServersFromIssue(issueUrl);
  console.log('Found KMS servers:', kmsServers);

  // 2. 测试 KMS 服务器连接，筛选有效的服务器
  const validKmsServers = [];
  for (const server of kmsServers) {
    const isValid = await testKmsServer(server);
    if (isValid) {
      validKmsServers.push(server);
    }
  }
  console.log('Valid KMS servers:', validKmsServers);

  // 3. 选择一个有效的 KMS 服务器 (例如，选择第一个)
  if (validKmsServers.length > 0) {
    const selectedServer = validKmsServers[0].split(':')[0]; // 提取 IP/域名
    console.log('Selected KMS server:', selectedServer);

    // 4. 更新 Cloudflare DNS 记录
    await updateCloudflareDnsRecord(apiToken, zoneId, recordName, selectedServer);
  } else {
    console.warn('No valid KMS servers found.');
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
