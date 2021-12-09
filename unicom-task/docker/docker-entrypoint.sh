#!/bin/bash
set -e

if [ ! -d /root/config ]; then
  echo -e "没有映射/unicom-task/config配置目录给本容器，请先按教程映射/unicom-task/config配置目录...\n"
  exit 1
fi

echo -e "\n========================1. 更新脚本源代码========================\n"
cd /myScripts
git pull origin ${SCRIPT_BRANCH}
echo

echo -e "========================2. 检测配置文件========================\n"

if [ ! -s /root/config/config.json ]; then
  echo -e "检测到/unicom-task/config配置目录下不存在config.json，从脚本中复制一份用于初始化...\n"
  cp -fv /myScripts/unicom-task/docker/config.json /root/config/config.json
  echo
fi

if [ ! -s /root/config/crontab.list ]; then
  echo -e "检测到/unicom-task/config配置目录下不存在crontab.list，从脚本中复制一份用于初始化...\n"
  cp -fv /myScripts/unicom-task/docker/crontab.list /root/config/crontab.list
  echo
fi

if [ -s /root/config/crontab.list ]
then
  echo -e "自动导入定时任务...\n"
  service crond start ##启动服务
  crontab /root/config/crontab.list
  echo -e "成功添加定时任务...\n"
else
  echo -e "检测到/unicom-task/config配置目录下不存在crontab.list或存在但文件为空，请手动添加crontab.list\n"
  echo
fi


echo -e "容器启动成功...\n"
echo -e "定时任务如下...\n"
crontab -l
crond -f

exec "$@"
