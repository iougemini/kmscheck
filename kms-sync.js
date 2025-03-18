const fetch = require('node-fetch');
const Cloudflare = require('cloudflare');
const net = require('net');

// 从 Issues 页面抓取 KMS 服务器地址
async function getKmsServersFromIssue(issueUrl) {
  try {
    const response = await fetch(issueUrl);
    const text = await response.text();

    // 使用正则表达式提取 KMS 服务器地址
    const regex = /(?:kms|KMS)\s*:\s*([a-zA-Z0-9.-]+:\d+)/g;
    let match;
    const servers = [];
    while ((match = regex.exec(text)) !== null) {
      servers.push(match[1]);
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
      console.error(`KMS server ${serverAddress} connection failed:`, error);
      resolve(false);
    });
  });
}

// 更新 Cloudflare DNS 记录
async function updateCloudflareDnsRecord(apiToken, zoneId, recordName, recordValue) {
  const cf = new Cloudflare({ token: apiToken });

  try {
    const zones = await cf.zones.browse();
    const zone = zones.result.find(z => z.id === zoneId);

    if (!zone) {
      throw new Error(`Zone with ID ${zoneId} not found.`);
    }

    const dnsRecords = await cf.dnsRecords.browse(zoneId);
    const existingRecord = dnsRecords.result.find(record => record.name === recordName && record.type === 'A');

    if (existingRecord) {
      await cf.dnsRecords.edit(zoneId, existingRecord.id, {
        type: 'A',
        name: recordName,
        content: recordValue,
        ttl: 3600,
      });
      console.log(`DNS record ${recordName} updated to ${recordValue}`);
    } else {
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
  }
}

async function main() {
  const issueUrl = 'https://github.com/iougemini/iougemini.github.io/issues/1';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const recordName = process.env.DNS_RECORD_NAME;

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

main();
