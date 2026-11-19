FROM python@sha256:07d4824036af339fa1b6ef769cc99d9c10a141769538b52b3b597c84f7a7b535

WORKDIR /app

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools && pip install --no-cache-dir --root-user-action=ignore -r requirements.txt

COPY --chown=10001:10001 . .
RUN chown 10001:10001 /app
USER 10001:10001

EXPOSE 8000

CMD ["python", "main.py"]
