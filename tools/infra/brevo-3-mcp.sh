#!/usr/bin/env bash
# Registra o TOKEN MCP do Brevo no cofre, com identificação.
# Painel: app.brevo.com > SMTP e API > Chaves de API > Gerar uma nova chave de API > nome: peticao-mcp > marque "Create MCP server API key"
exec node /mnt/apps/peticao-final/peticao/tools/infra/chave.mjs brevo:mcp
