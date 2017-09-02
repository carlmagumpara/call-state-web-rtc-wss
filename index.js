var WebSocketServer = require('websocket').server;
var http = require("http");
var express = require("express");
var app = express();
var port = process.env.PORT || 5000;
var connections = [];
var users = [];
var disconnectTimeouts = {};
var userDisconnectTimeout = 5000;
var callTimeouts = {};
var callWaiting = 30000;
var busyUsers = [];
var server = http.createServer(app);
server.listen(port);
app.use(express.static(__dirname + '/'));
console.log('http server listening on %d', port);
wsServer = new WebSocketServer({
  httpServer: server
});
wsServer.on('request', function(request) {
  var connection = request.accept(null, request.origin);
  connection.on('message', function(message) {
    if (message.type === 'utf8') {
      var data = JSON.parse(message.utf8Data);
      switch(data.type) {
        case 'subscribe':
          if (users.indexOf(data.user_id) === -1) {
            users.push(data.user_id);
            console.log('['+ new Date().toLocaleString() +'] Connection: 1 user connected');
            console.log('['+ new Date().toLocaleString() +'] Connection: '+users.length+' total user(s) connected');
          }
          if (typeof disconnectTimeouts[data.user_id] !== 'undefined') {
            clearTimeout(disconnectTimeouts[data.user_id]);
            delete disconnectTimeouts[data.user_id];
          }
          var userConnection = [connection,data.user_id];
          connections.push(userConnection);
          request['user_connection'] = userConnection;
          request['user_id'] = data.user_id;
          break;
        case 'calling':
          if (typeof disconnectTimeouts[data.callee_id] == 'undefined') {
            if (users.indexOf(data.callee_id) === -1) {
              console.log('['+ new Date().toLocaleString() +'] Offline: Caller: ' +data.caller_id+ ' & Callee: '+ data.callee_id);
              var json = JSON.stringify({ type:'user-is-offline', message: 'User is offline' });
              connection.sendUTF(json);
            } else {
              if (busyUsers.indexOf(data.callee_id) === -1) {
                var roomId = makeRoomID();
                addToBusyUsers(data.callee_id, data.caller_id);
                console.log('['+ new Date().toLocaleString() +'] Calling: Caller: ' +data.caller_id+ ' & Callee: '+ data.callee_id);
                for (var i = 0; i < connections.length; i++) {
                  if (connections[i][1] == data.callee_id) {
                    var json = JSON.stringify({ type:'calling', caller_name: data.caller_name, caller_id: data.caller_id, room_id: roomId });
                    connections[i][0].sendUTF(json);
                  }
                }
                var json = JSON.stringify({ type:'ringing', callee_name: data.callee_name, callee_id: data.callee_id, room_id: roomId });
                connection.sendUTF(json);
                callTimeouts[data.caller_id] =  setTimeout(function() {
                  console.log('['+ new Date().toLocaleString() +'] Not Answered: Caller: ' +data.caller_id+ ' & Callee: '+ data.callee_id);
                  removeToBusyUsers(data.callee_id, data.caller_id);
                  for (var i = 0; i < connections.length; i++) {
                    if (connections[i][1] == data.callee_id) {
                      var json = JSON.stringify({ type:'missed-call', message: 'You missed a call from ' + data.caller_name + '.'  });
                      connections[i][0].sendUTF(json);
                    }
                  }
                  var json = JSON.stringify({ type:'not-answered', message: data.callee_name + ' not answered.' });
                  connection.sendUTF(json)
                  clearTimeout(callTimeouts[data.caller_id]);
                  delete callTimeouts[data.caller_id];
                }, callWaiting);
              } else {
                console.log('['+ new Date().toLocaleString() +'] User Busy: Caller: ' +data.caller_id+ ' & Callee: '+ data.callee_id);
                var json = JSON.stringify({ type:'user-busy', message: 'User is busy' });
                connection.sendUTF(json);
              }
            }
          } else {
            console.log('['+ new Date().toLocaleString() +'] Offline: Caller: ' +data.caller_id+ ' & Callee: '+ data.callee_id);
            var json = JSON.stringify({ type:'user-is-offline', message: 'User is offline' });
            connection.sendUTF(json);
          }
          break;
        case 'accepted':   
          console.log('['+ new Date().toLocaleString() +'] Accepted: Caller: ' +data.caller_id+ ' & Callee: '+ data.callee_id);
          clearTimeout(callTimeouts[data.caller_id]);
          delete callTimeouts[data.caller_id];
          removeToBusyUsers(data.callee_id, data.caller_id);
          var json = JSON.stringify({ type:'accepted', callee_id: data.callee_id, callee_name: data.callee_name, caller_id: data.caller_id, caller_name: data.caller_name });
          for (var i = 0; i < connections.length; i++) {
            if (connections[i][1] == data.caller_id) {
              connections[i][0].sendUTF(json);
            }
            if (connections[i][1] == data.callee_id) {
              connections[i][0].sendUTF(json);
            }
          }
          break;
        case 'rejected':
          console.log('['+ new Date().toLocaleString() +'] Rejected: Caller: ' +data.caller_id+ ' & Callee: '+ data.callee_id);
          clearTimeout(callTimeouts[data.caller_id]);
          delete callTimeouts[data.caller_id];
          removeToBusyUsers(data.callee_id, data.caller_id);
          var json = JSON.stringify({ type:'rejected', callee_id: data.callee_id, callee_name: data.callee_name, caller_id: data.caller_id, caller_name: data.caller_name, message: data.callee_name + ' declined your call.' });
          for (var i = 0; i < connections.length; i++) {
            if (connections[i][1] == data.caller_id) {
              connections[i][0].sendUTF(json);
            }
            if (connections[i][1] == data.callee_id) {
              connections[i][0].sendUTF(json);
            }
          }
          break;
        case 'cancelled':
          console.log('['+ new Date().toLocaleString() +'] Cancelled: Caller: ' +data.caller_id+ ' & Callee: '+ data.callee_id);
          clearTimeout(callTimeouts[data.caller_id]);
          delete callTimeouts[data.caller_id];
          removeToBusyUsers(data.callee_id, data.caller_id);
          var json = JSON.stringify({ type:'cancelled', callee_id: data.callee_id, callee_name: data.callee_name, caller_id: data.caller_id, caller_name: data.caller_name, message: data.caller_name + ' cancelled call.' });
          for (var i = 0; i < connections.length; i++) {
            if (connections[i][1] == data.callee_id) {
              connections[i][0].sendUTF(json);
            }
          }
          break;
        case 'message':
          var json = JSON.stringify({ type:'message', chatee_id: data.chatee_id, chatee_name: data.chatee_name, chatter_id: data.chatter_id, chatter_name: data.chatter_name, message: data.message });
          for (var i = 0; i < connections.length; i++) {
            if (connections[i][1] == data.chatee_id) {
              connections[i][0].sendUTF(json);
            }
          }
          connection.sendUTF(json);
          break;
        case 'typing':
          var json = JSON.stringify({ type:'typing', chatee_id: data.chatee_id, chatee_name: data.chatee_name, chatter_id: data.chatter_id, chatter_name: data.chatter_name, message: data.message });
          for (var i = 0; i < connections.length; i++) {
            if (connections[i][1] == data.chatee_id) {
              connections[i][0].sendUTF(json);
            }
          }
          break;
        case 'remove-to-busy-users':
          for (var i = 0; i < data.users.length; i++) {
            if (busyUsers.indexOf(data.users[i]) === 0) {
              console.log('['+ new Date().toLocaleString() +'] Busy: '+data.users[i]+' remove to busy users!');
              busyUsers.splice(busyUsers.indexOf(data.users[i]), 1);
            }
          }
          break;
        case 'add-to-busy-users':
          if (busyUsers.indexOf(data.user) === -1) {
            console.log('['+ new Date().toLocaleString() +'] Busy: '+data.user+' added to busy users!');
            busyUsers.push(data.user);
          }
          break;
        default:
          console.log('[Server]: Opss... Something\'s wrong here.');
      }
      updateActiveUsers();
    }
  });

  connection.on('close', function(connection) {
    connections.splice(connections.indexOf(request['user_connection']), 1);
    var stillActive = false;
    for (var i = 0; i < connections.length; i++) {
      if (connections[i][1] == request['user_id']) {
        stillActive = true;
        break;
      }
    }
    if (stillActive == false) {
      disconnectTimeouts[request['user_id']] = setTimeout(function() {
        clearTimeout(disconnectTimeouts[request['user_id']]);
        delete disconnectTimeouts[request['user_id']];
        users.splice(users.indexOf(request['user_id']), 1);
        console.log('['+ new Date().toLocaleString() +'] Connection: 1 user disconnected');
        console.log('['+ new Date().toLocaleString() +'] Connection: '+users.length+' total user(s) connected');
        updateActiveUsers();
      }, userDisconnectTimeout);
    }
  })

  function updateActiveUsers() {
    var json = JSON.stringify({ type:'subscribe', data: users });
    for (var i = 0; i < connections.length; i++) {
      connections[i][0].sendUTF(json);
    }
  }

  function addToBusyUsers(user_1, user_2) {
    var busyUser = [user_1,user_2];
    for (var i = 0; i < busyUser.length; i++) {
      console.log('['+ new Date().toLocaleString() +'] Busy: '+busyUser[i]+' added to busy users!');
      busyUsers.push(busyUser[i]);
    }
  }

  function removeToBusyUsers(user_1, user_2) {
    var busyUser = [user_1,user_2];
    for (var i = 0; i < busyUser.length; i++) {
      console.log('['+ new Date().toLocaleString() +'] Busy: '+busyUser[i]+' remove to busy users!');
      busyUsers.splice(busyUsers.indexOf(busyUser[i]), 1);
    }
  }

  function makeRoomID() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < 30; i++)
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
  }

})
