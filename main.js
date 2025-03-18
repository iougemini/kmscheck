const fetch = require('node-fetch');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// 启用详细的 HTTP 调试（可选）
process.env.NODE_DEBUG = 'http';

// 配置参数
const config = {
  issueOwner: 'iougemini',
  issueRepo: 'iougemini.github.io',
  issueNumber: '1',
  dnsRecordName: 'kms.everyhub.top',
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
  cloudflareZoneId: process.env.CLOUDFLARE_ZONE_ID,
  cloudflareEmail: process.env.CLOUDFLARE_EMAIL,
  githubToken: process.env.GITHUB_TOKEN || ''
};

// 主函数
async function main() {
  try {
    console.log('Starting KMS server sync process');
    console.log(`DNS record name: ${config.dnsRecordName}`);

    // 从 GitHub Issue 获取 KMS 服务器列表
    const kmsServers = await getKmsServersFromIssue();
    
    // 验证 KMS 服务器的可用性
    const validKmsServers = await validateKmsServers(kmsServers);
    console.log(`Valid KMS servers: ${JSON.stringify(validKmsServers)}`);

    if (validKmsServers.length > 0) {
      // 选择一个有效的 KMS 服务器
      const selectedServer = selectKmsServer(validKmsServers);
      console.log(`Selected KMS server: ${selectedServer}`);

      // 更新 Cloudflare DNS 记录
      await updateCloudflareRecord(selectedServer);
    } else {
      console.error('No valid KMS servers found, DNS record not updated.');
    }
  } catch (error) {
    console.error('Error in main process:', error);
    process.exit(1);
  }
}

// 从 GitHub Issue 获取 KMS 服务器列表
async function getKmsServersFromIssue() {
  try {
    const apiUrl = `https://api.github.com/repos/${config.issueOwner}/${config.issueRepo}/issues/${config.issueNumber}`;
    console.log(`Fetching KMS servers from GitHub API: ${apiUrl}`);
    
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'KMS-Server-Sync-Script'
    };
    
    // 如果有 GitHub Token，则添加到请求头
    if (config.githubToken) {
      console.log('Using GitHub token for authentication');
      headers['Authorization'] = `token ${config.githubToken}`;
    }
    
    const response = await fetch(apiUrl, { headers });
    
    // 检查响应状态
    console.log(`Response status: ${response.status} ${response.statusText}`);
    if (!response.ok) {
      console.error(`Failed to fetch issue: ${response.status} ${response.statusText}`);
      return useFallbackKmsServers();
    }
    
    const issueData = await response.json();
    const issueBody = issueData.body || '';
    
    console.log(`Issue title: ${issueData.title}`);
    console.log(`Issue body length: ${issueBody.length} characters`);
    console.log(`Issue body preview: ${issueBody.substring(0, 200)}...`);
    
    // 使用多个正则表达式模式匹配 KMS 服务器地址
    const servers = extractKmsServers(issueBody);
    
    if (servers.length === 0) {
      console.warn('No KMS servers found in the issue content with any pattern');
      return useFallbackKmsServers();
    }
    
    return servers;
  } catch (error) {
    console.error('Error fetching KMS servers from issue:', error);
    return useFallbackKmsServers();
  }
}

// 从文本中提取 KMS 服务器地址
function extractKmsServers(text) {
  const servers = new Set();
  
  // 定义多个正则表达式模式来匹配不同格式的 KMS 服务器地址
  const regexPatterns = [
    // 匹配 kms:server:port 或 KMS:server:port 格式
    /(?:kms|KMS)\s*:\s*([a-zA-Z0-9.-]+(?::\d+)?)/g,
    
    // 匹配域名格式的服务器地址（可能带有端口）
    /\b([a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z0-9]+)(?::(\d+))?\b/g,
    
    // 匹配 IP 地址格式（可能带有端口）
    /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d+))?\b/g,
    
    // 匹配 "服务器" 或 "server" 后面的地址
    /(?:服务器|server)[^\w\d\r\n]*([a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z0-9]+(?::\d+)?)/gi
  ];
  
  // 使用每个正则表达式模式尝试匹配
  for (const regexPattern of regexPatterns) {
    const regex = new RegExp(regexPattern);
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      let server;
      
      // 处理不同的匹配组
      if (regex.source.includes('\\d{1,3}\\.\\d{1,3}')) {
        // IP 地址格式
        server = match[1] + (match[2] ? `:${match[2]}` : ':1688');
      } else if (match[2]) {
        // 域名带端口格式
        server = `${match[1]}:${match[2]}`;
      } else if (match[1].includes(':')) {
        // 已包含端口的格式
        server = match[1];
      } else {
        // 仅域名格式，添加默认端口
        server = `${match[1]}:1688`;
      }
      
      // 过滤掉明显不是 KMS 服务器的地址
      if (!isLikelyKmsServer(server)) {
        continue;
      }
      
      servers.add(server);
      console.log(`Found potential KMS server: ${server}`);
    }
  }
  
  // 特别处理您提到的三个服务器地址
  const specificServers = [
    'kms.hmg.pw:1688',
    'kms.xingez.me:1688',
    '140.246.142.164:1688'
  ];
  
  for (const server of specificServers) {
    if (text.includes(server.split(':')[0])) {
      servers.add(server);
      console.log(`Found specific KMS server: ${server}`);
    }
  }
  
  return Array.from(servers);
}

// 判断是否可能是 KMS 服务器地址
function isLikelyKmsServer(server) {
  // 过滤掉常见的非 KMS 服务器地址
  const notKmsPatterns = [
    /github\.com/i,
    /example\.com/i,
    /localhost/i,
    /127\.0\.0\.1/,
    /test\./i,
    /\.js$/i,
    /\.css$/i,
    /\.html$/i,
    /\.png$/i,
    /\.jpg$/i,
    /\.gif$/i
  ];
  
  for (const pattern of notKmsPatterns) {
    if (pattern.test(server)) {
      return false;
    }
  }
  
  // 检查是否包含 KMS 相关关键词
  const kmsPatterns = [
    /kms/i,
    /vlmcs/i,
    /activate/i,
    /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/  // IP 地址格式
  ];
  
  for (const pattern of kmsPatterns) {
    if (pattern.test(server)) {
      return true;
    }
  }
  
  // 默认情况下，如果是域名格式且不在排除列表中，则认为可能是 KMS 服务器
  return /[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z0-9]+/.test(server);
}

// 提供备选的 KMS 服务器列表
function useFallbackKmsServers() {
  console.log('Using fallback KMS server list');
  return [
    'kms.hmg.pw:1688',
    'kms.xingez.me:1688',
    '140.246.142.164:1688',
    'kms.03k.org:1688',
    'kms.chinancce.com:1688',
    'kms.ddns.net:1688',
    'kms.ddz.red:1688',
    'kms.lotro.cc:1688',
    'kms.luody.info:1688',
    'kms.moeclub.org:1688',
    'kms8.MSGuides.com:1688',
    'xykz.f3322.org:1688',
    'kms.cangshui.net:1688'
  ];
}

// 验证 KMS 服务器的可用性
async function validateKmsServers(servers) {
  console.log(`Validating ${servers.length} KMS servers...`);
  const validServers = [];
  
  for (const server of servers) {
    try {
      const [host, port] = server.split(':');
      console.log(`Testing KMS server: ${host}:${port}`);
      
      // 使用 nc 命令测试服务器连接
      const { stdout, stderr } = await execPromise(`nc -zv -w 3 ${host} ${port}`, { timeout: 5000 });
      console.log(`nc command output: ${stdout}`);
      
      if (stderr && stderr.includes('Connection refused')) {
        console.log(`KMS server ${server} is not available`);
        continue;
      }
      
      console.log(`KMS server ${server} is valid`);
      validServers.push(server);
    } catch (error) {
      console.log(`Error testing KMS server ${server}: ${error.message}`);
    }
  }
  
  return validServers;
}

// 选择一个有效的 KMS 服务器
function selectKmsServer(validServers) {
  // 简单地选择第一个有效的服务器
  // 可以根据需要实现更复杂的选择逻辑，如随机选择或基于响应时间选择
  return validServers[0];
}

// 更新 Cloudflare DNS 记录
async function updateCloudflareRecord(selectedServer) {
  try {
    console.log(`Updating Cloudflare DNS record for ${config.dnsRecordName} to point to ${selectedServer}`);
    
    // 首先获取现有的 DNS 记录
    const recordId = await getCloudflareRecordId();
    
    if (!recordId) {
      console.log('DNS record not found, creating new record');
      await createCloudflareRecord(selectedServer);
    } else {
      console.log(`Updating existing DNS record with ID: ${recordId}`);
      await updateCloudflareRecordById(recordId, selectedServer);
    }
    
    console.log('Cloudflare DNS record updated successfully');
  } catch (error) {
    console.error('Error updating Cloudflare DNS record:', error);
    throw error;
  }
}

// 获取 Cloudflare DNS 记录 ID
async function getCloudflareRecordId() {
  try {
    const url = `https://api.cloudflare.com/client/v4/zones/${config.cloudflareZoneId}/dns_records?name=${config.dnsRecordName}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.cloudflareApiToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get DNS records: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.result && data.result.length > 0) {
      return data.result[0].id;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting Cloudflare DNS record ID:', error);
    throw error;
  }
}

// 创建新的 Cloudflare DNS 记录
async function createCloudflareRecord(selectedServer) {
  try {
    const [host, port] = selectedServer.split(':');
    const url = `https://api.cloudflare.com/client/v4/zones/${config.cloudflareZoneId}/dns_records`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.cloudflareApiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'CNAME',
        name: config.dnsRecordName,
        content: host,
        ttl: 120,
        proxied: false
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to create DNS record: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
    }
    
    const data = await response.json();
    console.log(`Created new DNS record with ID: ${data.result.id}`);
    
    return data.result.id;
  } catch (error) {
    console.error('Error creating Cloudflare DNS record:', error);
    throw error;
  }
}

// 更新现有的 Cloudflare DNS 记录
async function updateCloudflareRecordById(recordId, selectedServer) {
  try {
    const [host, port] = selectedServer.split(':');
    const url = `https://api.cloudflare.com/client/v4/zones/${config.cloudflareZoneId}/dns_records/${recordId}`;
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${config.cloudflareApiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'CNAME',
        name: config.dnsRecordName,
        content: host,
        ttl: 120,
        proxied: false
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to update DNS record: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
    }
    
    const data = await response.json();
    console.log(`Updated DNS record with ID: ${data.result.id}`);
    
    return data.result.id;
  } catch (error) {
    console.error('Error updating Cloudflare DNS record:', error);
    throw error;
  }
}

// 执行主函数
main().catch(error => {
  console.error('Unhandled error in main process:', error);
  process.exit(1);
});
