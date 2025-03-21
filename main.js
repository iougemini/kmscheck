// main.js 完整代码

const fetch = require('node-fetch');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// 环境变量配置
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const email = process.env.CLOUDFLARE_EMAIL;
const githubToken = process.env.GITHUB_TOKEN;

// 配置参数
const dnsRecordName = 'kms.everyhub.top';
const githubIssueUrl = 'https://api.github.com/repos/iougemini/iougemini.github.io/issues/1';

// 辅助函数：检查字符串是否为有效IP地址
function isValidIpAddress(str) {
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  if (!ipv4Regex.test(str)) return false;
  
  const parts = str.split('.').map(part => parseInt(part, 10));
  return parts.every(part => part >= 0 && part <= 255);
}

// 主函数
async function main() {
  console.log('Starting KMS server sync process');
  console.log(`DNS record name: ${dnsRecordName}`);
  
  try {
    // 从 GitHub 获取 KMS 服务器列表
    let kmsServers = await fetchKmsServersFromGithub();
    
    if (!kmsServers || kmsServers.length === 0) {
      console.log('Using fallback KMS server list');
      kmsServers = [
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
    
    // 验证 KMS 服务器
    console.log(`Validating ${kmsServers.length} KMS servers...`);
    const validServers = await validateKmsServers(kmsServers);
    console.log(`Valid KMS servers: ${JSON.stringify(validServers)}`);
    
    if (validServers.length === 0) {
      throw new Error('No valid KMS servers found');
    }
    
    // 选择一个有效的 KMS 服务器
    const selectedServer = validServers[0];
    console.log(`Selected KMS server: ${selectedServer}`);
    
    // 从选定的服务器中分离主机名和端口
    const [serverHost, serverPort] = selectedServer.split(':');
    console.log(`Updating Cloudflare DNS record for ${dnsRecordName} to point to ${serverHost} (KMS server port: ${serverPort})`);
    
    // 判断是IP地址还是域名，并相应地设置记录类型
    const isIpAddress = isValidIpAddress(serverHost);
    const recordType = isIpAddress ? 'A' : 'CNAME';
    console.log(`Server host ${serverHost} is ${isIpAddress ? 'an IP address' : 'a domain name'}, using ${recordType} record`);
    
    // 更新 Cloudflare DNS 记录
    await updateCloudflareRecord(serverHost, recordType);
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// 从 GitHub 获取 KMS 服务器列表
async function fetchKmsServersFromGithub() {
  console.log(`Fetching KMS servers from GitHub API: ${githubIssueUrl}`);
  
  const headers = {
    'Accept': 'application/vnd.github.v3+json'
  };
  
  if (githubToken) {
    console.log('Using GitHub token for authentication');
    headers['Authorization'] = `token ${githubToken}`;
  }
  
  try {
    const response = await fetch(githubIssueUrl, { headers });
    console.log(`Response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
    
    const issueData = await response.json();
    console.log(`Issue title: ${issueData.title}`);
    
    // 尝试从 issue 内容中提取 KMS 服务器
    const kmsServers = [];
    
    // 尝试不同的模式匹配 KMS 服务器地址
    const patterns = [
      /(\S+:\d+)/g,  // 匹配 host:port 格式
      /kms\S*\.\S+/g // 匹配以 kms 开头的域名
    ];
    
    let found = false;
    for (const pattern of patterns) {
      const matches = issueData.body.match(pattern);
      if (matches && matches.length > 0) {
        kmsServers.push(...matches);
        found = true;
      }
    }
    
    if (!found) {
      console.log('No KMS servers found in the issue content with any pattern');
      console.log(`Issue body length: ${issueData.body.length} characters`);
      console.log(`Issue body preview: ${issueData.body.substring(0, 50)}...`);
    }
    
    return kmsServers;
  } catch (error) {
    console.error(`Error fetching KMS servers from GitHub: ${error.message}`);
    return [];
  }
}

// 验证 KMS 服务器是否可用
async function validateKmsServers(servers) {
  const validServers = [];
  
  for (const server of servers) {
    try {
      const [host, port] = server.split(':');
      console.log(`Testing KMS server: ${server}`);
      
      const { stdout, stderr } = await execPromise(`nc -zv -w 3 ${host} ${port}`);
      console.log(`nc command output: ${stdout}`);
      
      // 如果没有抛出异常，则认为服务器有效
      console.log(`KMS server ${server} is valid`);
      validServers.push(server);
    } catch (error) {
      console.error(`Error testing KMS server ${server}: ${error.message}`);
    }
  }
  
  return validServers;
}

// 更新 Cloudflare DNS 记录
async function updateCloudflareRecord(serverHost, recordType) {
  const headers = {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
    'X-Auth-Email': email
  };
  
  // 创建 DNS 记录数据
  const recordData = {
    type: recordType,
    name: dnsRecordName,
    content: serverHost,
    ttl: 120,
    proxied: false
  };
  
  try {
    // 首先检查是否已存在记录
    const checkResponse = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${dnsRecordName}`, {
      headers
    });
    
    const checkData = await checkResponse.json();
    
    if (!checkData.success) {
      throw new Error(`Failed to check existing DNS records: ${JSON.stringify(checkData.errors)}`);
    }
    
    let existingRecordId = null;
    let method = 'POST';
    let apiUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;
    
    if (checkData.result.length > 0) {
      existingRecordId = checkData.result[0].id;
      method = 'PUT';
      apiUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${existingRecordId}`;
      console.log(`Updating existing DNS record with ID: ${existingRecordId}`);
    } else {
      console.log('DNS record not found, creating new record');
    }
    
    // 创建或更新 DNS 记录
    const response = await fetch(apiUrl, {
      method: method,
      headers: headers,
      body: JSON.stringify(recordData)
    });
    
    const responseData = await response.json();
    console.log('Cloudflare API Response:', JSON.stringify(responseData, null, 2));
    
    if (responseData.success) {
      console.log(`${existingRecordId ? 'Updated' : 'Created new'} DNS record with ID: ${responseData.result.id}`);
      console.log(`DNS now points to: ${responseData.result.content} (${recordType} record)`);
    } else {
      throw new Error(`Failed to ${existingRecordId ? 'update' : 'create'} DNS record: ${JSON.stringify(responseData.errors)}`);
    }
    
    // 验证 DNS 记录已更新
    console.log('Verifying DNS record update...');
    const verifyResponse = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${dnsRecordName}`, {
      headers: headers
    });
    
    const verifyData = await verifyResponse.json();
    if (verifyData.success && verifyData.result.length > 0) {
      console.log(`Verification successful. DNS record points to: ${verifyData.result[0].content} (${verifyData.result[0].type} record)`);
      console.log('Cloudflare DNS record updated successfully');
    } else {
      console.warn('Could not verify DNS record update. You may need to check the Cloudflare dashboard.');
    }
    
  } catch (error) {
    throw new Error(`Error updating Cloudflare DNS record: ${error.message}`);
  }
}

// 执行主函数
main();
