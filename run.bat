@echo off
chcp 65001 >nul
echo ============================================================
echo   工程质量监督智能匹配Agent - 启动中...
echo ============================================================
echo.

REM 设置Python路径
set PYTHON_PATH=C:\Users\Colincong laptop\.workbuddy\binaries\python\versions\3.13.12\python.exe

REM 检查Python是否存在
if not exist "%PYTHON_PATH%" (
    echo [错误] 未找到Python，请检查路径: %PYTHON_PATH%
    pause
    exit /b 1
)

REM 创建虚拟环境（如果不存在）
set VENV_PATH=C:\Users\Colincong laptop\.workbuddy\binaries\python\envs\default
if not exist "%VENV_PATH%" (
    echo [信息] 创建虚拟环境...
    "%PYTHON_PATH%" -m venv "%VENV_PATH%"
)

REM 使用虚拟环境的pip安装依赖
set PIP_PATH=%VENV_PATH%\Scripts\pip.exe
set VENV_PYTHON=%VENV_PATH%\Scripts\python.exe

echo [信息] 检查并安装依赖...
"%PIP_PATH%" install flask --quiet 2>nul

REM 启动应用
echo.
echo [信息] 启动应用...
echo [信息] 请在浏览器中访问: http://127.0.0.1:5000
echo.
"%VENV_PYTHON%" "%~dp0app.py"

pause
