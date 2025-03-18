# KMS Server Sync

这个项目自动从GitHub Issues抓取KMS服务器地址，测试它们的可用性，并将有效的KMS服务器地址更新到Cloudflare DNS记录中。

## 功能

- 从指定的GitHub Issue抓取KMS服务器地址
- 测试KMS服务器的连接可用性
- 筛选有效的KMS服务器
- 自动更新Cloudflare DNS记录
- 通过GitHub Actions每周自动运行

## 设置

1. Fork这个仓库
2. 在GitHub仓库设置中添加以下Secrets:
   - `CLOUDFLARE_API_TOKEN`: Cloudflare API令牌
   - `CLOUDFLARE_ZONE_ID`: Cloudflare区域ID
3. 在`kms-sync.yml`文件中修改`DNS_RECORD_NAME`为你的DNS记录名称
4. 启用GitHub Actions工作流

## 手动运行

你可以在GitHub Actions页面手动触发工作流，或者在本地运行:

```bash
# 安装依赖
npm install

# 设置环境变量
export CLOUDFLARE_API_TOKEN=your_token
export CLOUDFLARE_ZONE_ID=your_zone_id
export DNS_RECORD_NAME=kms.example.com

# 运行脚本
node kms-sync.js

