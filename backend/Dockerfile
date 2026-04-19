FROM python:3.12-slim

WORKDIR /app

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖（先复制，利用层缓存）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 应用代码
COPY app.py .

# 任务输出目录
RUN mkdir -p /app/jobs

# 词典文件通过 volume 挂载到 /data
# 期望结构：
#   /data/LDOCE5.mdx
#   /data/LDOCE5.mdd   （可选）

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:8765/health || exit 1

ENV MDX_PATH=/data/LDOCE5.mdx
ENV MDD_PATH=/data/LDOCE5.mdd

# entrypoint 脚本，支持通过环境变量传入路径
CMD python app.py \
    --mdx "${MDX_PATH}" \
    $([ -f "${MDD_PATH}" ] && echo "--mdd ${MDD_PATH}") \
    --port 8765