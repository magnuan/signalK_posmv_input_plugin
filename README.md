# signalK_posmv_input_plugin
SignalK plugin for reading position and attitude from Applanix PosMV $GRP1 messages


# Bind mount plugin folder into /home/node/.signalk/node_modules insid edocker image

docker volume create signalk-config 
docker run -d --init  --name signalk-server --net=host --restart unless-stopped  -v /home/magnuan/git/signalk_plugins/signalK_posmv_input_plugin/:/home/node/.signalk/node_modules/posmv_input_plugin -v signalk-config:/home/node/.signalk cr.signalk.io/signalk/signalk-server 
