@echo off
title SWG Consulting SST - Deploy
color 0B
echo.
echo  ==========================================
echo   SWG Consulting SST - Deploy Automatico
echo  ==========================================
echo.

cd /d "%~dp0"

echo  Enviando arquivos para o GitHub...
git add .

set /p msg="  Mensagem (Enter para usar padrao): "
if "%msg%"=="" set msg=update

git commit -m "%msg%"
git push

if %errorlevel% neq 0 (
    echo.
    echo  ERRO no push! Verifique sua conexao.
    pause
    exit
)

echo.
echo  Codigo enviado com sucesso!
echo  Aguardando deploy na Vercel...
echo.

timeout /t 15 /nobreak

echo  Abrindo o sistema...
start https://swgconsulting-sst.vercel.app

echo.
echo  Deploy concluido! Sistema aberto no navegador.
echo.
pause
