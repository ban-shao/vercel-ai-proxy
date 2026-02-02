#!/bin/bash

set -e

echo ""
echo "============================================="
echo "   Vercel AI Proxy 安装脚本"
echo "============================================="
echo ""

# 检查 Node.js
echo "[1/5] 检查 Node.js 环境..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请先安装 Node.js 18+"
    echo "   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "   sudo apt-get install -y nodejs"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 版本过低，需要 18+，当前: $(node -v)"
    exit 1
fi
echo "✓ Node.js $(node -v)"

# 安装目录
INSTALL_DIR="/opt/vercel-ai-proxy"
echo ""
echo "[2/5] 创建安装目录..."
sudo mkdir -p $INSTALL_DIR
sudo chown -R $USER:$USER $INSTALL_DIR
echo "✓ 安装目录: $INSTALL_DIR"

# 复制文件
echo ""
echo "[3/5] 复制项目文件..."
cp -r ./* $INSTALL_DIR/
cd $INSTALL_DIR
echo "✓ 文件已复制"

# 安装依赖
echo ""
echo "[4/5] 安装依赖并编译..."
npm install
npm run build
echo "✓ 依赖安装完成"

# 配置文件
echo ""
echo "[5/5] 创建配置文件..."
if [ ! -f "$INSTALL_DIR/.env" ]; then
    # 生成随机 AUTH_KEY
    AUTH_KEY=$(openssl rand -hex 16)
    
    cat > $INSTALL_DIR/.env << EOF
# 服务端口
PORT=3001

# 认证密钥（访问此代理服务需要的密钥）
AUTH_KEY=$AUTH_KEY

# 上游 Vercel AI Gateway 地址
UPSTREAM_URL=https://ai-gateway.vercel.sh

# 密钥文件路径
KEYS_FILE=data/keys/keys.txt

# 密钥冷却时间（小时）
KEY_COOLDOWN_HOURS=24

# 日志级别
LOG_LEVEL=info
EOF
    echo "✓ 配置文件已创建"
    echo "  AUTH_KEY: $AUTH_KEY"
else
    echo "✓ 配置文件已存在，跳过"
fi

# 创建目录
mkdir -p $INSTALL_DIR/data/keys
mkdir -p $INSTALL_DIR/logs

# 设置脚本可执行
chmod +x $INSTALL_DIR/scripts/*.sh

echo ""
echo "============================================="
echo "   安装完成！"
echo "============================================="
echo ""
echo "下一步:"
echo "  1. 添加密钥: nano $INSTALL_DIR/data/keys/keys.txt"
echo "  2. 启动服务: cd $INSTALL_DIR && npm start"
echo "  3. 或使用 PM2: npm install -g pm2 && pm2 start ecosystem.config.js"
echo ""
echo "API 地址: http://localhost:3001"
echo "AUTH_KEY: 查看 $INSTALL_DIR/.env"
echo ""
