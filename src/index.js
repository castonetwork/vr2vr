import "babel-polyfill";
import Promise from "es6-promise";
const pull = require("pull-stream");
const Pushable = require("pull-pushable");
const {tap} = require("pull-tap");
let sendStream = Pushable();
const wsSource = require("pull-ws/source");
const wsSink = require("pull-ws");

const pullPromise = require("pull-promise");
const stringify = require("pull-stringify");
let transactionQueue = {};
let pc;
const createNode = require("./create-node");
const chance = require("chance").Chance();

const domReady = new Promise((resolve, reject) => {
  console.log("DOM ready");
  

  resolve();
});

const _createSession = (janusStream) => {
  let tId = chance.guid();
  let request = {
    janus: "create",
    transaction: tId
  };
  janusStream.push(request);
  return new Promise((resolve, reject) => {
    transactionQueue[tId] = {
      id: tId,
      success: response => {
        let sessionId = response.data.id;
        console.log("_createSession : success");
        console.log(response);
        resolve(sessionId);
      },
      failure: response => {
        console.error("error: fail to create session");
        reject();
        return true;
      }
    };
  });
};

const _attach = (janusStream, sessionId)=> {
  let tId = chance.guid();
  let request = {
    janus: "attach",
    session_id: sessionId,
    plugin: "janus.plugin.videoroom",
    transaction: tId
  };
  janusStream.push(request);
  return new Promise((resolve, reject) => {
    transactionQueue[tId] = {
      id: tId,
      success: response => {
        //logger.debug('attch: id=' + response.data.id);
        console.log("attch: id=" + response.data.id);
        resolve(response.data.id);
        return true;
      },
      failure: response => {
        console.error(response.error.reason);
        reject();
        return true;
      }
    };
  });
}

const _startKeepAlive = (janusStream, sessionId, handleId) => {
  let timerId = setInterval(() => {
    let msg = {
      janus: "keepalive",
      session_id: sessionId,
      handle_id: handleId,
      transaction: chance.guid()
    };
    janusStream.push(msg);
  }, 30000);

  return timerId;
}
const createRoom = (janusStream, sessionId,handleId) => {
  let tId = chance.guid();
  let request = {
    janus: "message",
    session_id: sessionId,
    handle_id: handleId,
    transaction: tId,
    body : {
      request: "create",
      description: "remon",
      //   transaction: tId,
      bitrate: 102400,
      publishers: 1,
      fir_freq: 1,
      is_private: false,
      audiocodec: "opus",
      videocodec: "H264",
      video: true,
      audio: true,
      notify_joining: true,
      playoutdelay_ext: false,
      videoorient_ext: false
    }

  };

  janusStream.push(request);

  return new Promise((resolve, reject) => {
    transactionQueue[tId] = {
      id: tId,
      success: response => {
        
        resolve(response.plugindata.data.room);
        return true;
      },
      failure: response => {
        console.error(response.error.reason);
        return true;
      }
    };
  });
}

const _join = (sendJanusStream, broadcastObj) => {
  console.log("_join", broadcastObj)
  if (broadcastObj.type === "subscriber" && !broadcastObj)
    console.error("No broadCast info");
  let tId = chance.guid();

  let request = {
    janus: "message",
    session_id: broadcastObj.sessionId,
    handle_id: broadcastObj.handleId,
    transaction: tId,
    body: {
      request: "join",
      room: broadcastObj.roomId,
      ptype: broadcastObj.type, //"publisher", "subscriber",
      video: true,
      audio: true
    }
  };

  if (broadcastObj.type === "subscriber") {
    request.body.feed = broadcastObj.broadcastId;
  }

  sendJanusStream.push(request);

  return new Promise((resolve, reject) => {
    transactionQueue[tId] = {
      id: tId,
      ack: response => {
        console.log("Join ack")
        
      },
      event: response => {
        console.log("Join evnt")
        if ("error_code" in response.plugindata.data) {
          reject(
            "cmd:join " +
              " code:" +
              response.plugindata.data.error_code +
              ":" +
              " message:" +
              response.plugindata.data.error
          );
        } else {
          console.log("Join event", response)
          resolve(response);
          /*if ("jsep" in response) {
            resolve(response);
          } else {
            resolve(response);
          }*/
        }
      },
      failure: response => {
        reject("cmd:join response:" + response.janus);
        return true;
      }
    };
  });
}
///broadCastObj : sessionId, handleId, sdpType, sdp
const _configure = (sendJanusStream, broadcastObj) => {
  let tId = chance.guid();
  let request = {
    janus: "message",
    session_id: broadcastObj.sessionId,
    handle_id: broadcastObj.handleId,
    transaction: tId,
    body: {
      request: "configure",
      room: broadcastObj.roomId,
      ptype: "publisher",
      video: true,
      audio: true
    },
    jsep : broadcastObj.jsep
  };

  sendJanusStream.push(request);

  return new Promise((resolve, reject) => {
    transactionQueue[tId] = {
      id: tId,
      ack: response => {
        return false;
      },
      event: response => {
        //let handleId = response.sender;

        if ("error_code" in response.plugindata.data) {
          reject(
            response.plugindata.data.error_code +
              ":" +
              response.plugindata.data.error
          );
        } else {
          // let _sdp;
          // if ("jsep" in response) {
          //   response.jsep.sdp;
          // }
          resolve(response);
        }
        return true;
      },
      failure: response => {
        reject();
        return true;
      }
    };
  });
}
const addIceCandidate = (sendJanusStream, candidates, boadcastObj) => {
  const { sdpMid, sdpMLineIndex, candidate } = candidates;
  let tId = chance.guid();

  let request = {
    janus: "trickle",
    session_id: boadcastObj.sessionId,
    handle_id: boadcastObj.handleId,
    transaction: tId,
    candidate: {
      sdpMid: sdpMid,
      sdpMLineIndex: sdpMLineIndex,
      candidate: candidate
    }
  };

  sendJanusStream.push(request);
  return new Promise((resolve, reject) => {
    transactionQueue[tId] = {
      id: tId,
      ack: response => {
        resolve();
      }
    };
  });
}
const setting1 = (ws) => new Promise((resolve, reject)=>{
  let sendJanusStream = Pushable();
  let sessionId;
  let handleId;
  let keepaliveTimerId;
  let roomId;
  ws.onerror = console.error;
  ws.onclose = () => {
    console.log("CONNECTION CLOSED!");
    clearInterval(keepaliveTimerId)
  };

  ws.onopen = async () => {
    //setSendStream
    pull(
      sendJanusStream,
      stringify(),
      tap(o => console.log("[SENT]", o)),
      wsSink(ws)
    );
    //setReceiveStream
    pull(
      wsSource(ws),
      pull.map(o => JSON.parse(o)),
      tap(o => {
        if (o.janus !== "ack") console.log("[RECV] ", o);
      }),
      pull.drain(o =>{ 
        console.log(o)
        console.log(o.transaction);
        console.log(transactionQueue[o.transaction] );
        o && transactionQueue[o.transaction] && transactionQueue[o.transaction][o.janus](o)
      })
    );
    //init ws
      sessionId = await _createSession(sendJanusStream);
      handleId  = await _attach(sendJanusStream, sessionId);
      keepaliveTimerId = _startKeepAlive(sendJanusStream, sessionId, handleId);
      roomId = await createRoom(sendJanusStream, sessionId, handleId);
      let joinedInfo = await _join(sendJanusStream, {
        sessionId,
        handleId,
        roomId,
        type : "publisher"
      });
      window.roomInfo = {
        roomId,
        publisherId : joinedInfo.plugindata.data.id
      }
      


      pc = new RTCPeerConnection(null);
  
      // send any ice candidates to the other peer
      pc.onicecandidate = event => {
        console.log("[ICE]", event);
        if (event.candidate) {
          addIceCandidate(
            sendJanusStream,
            event.candidate,
            {
              sessionId,
              handleId
            }
          )
          // sendStream.push({
          //   request: "sendTrickleCandidate",
          //   candidate: event.candidate
          // });
        }
      };
      pc.oniceconnectionstatechange = function(e) {
        console.log("[ICE STATUS] ", pc.iceConnectionState);
      };
  
      // let the "negotiationneeded" event trigger offer generation
      pc.onnegotiationneeded = async () => {};
  
      try {
        // get a local stream, show it in a self-view and add it to be sent
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        document.getElementById("studio").srcObject = stream;
        try {
          let sdp = await pc.createOffer();
          await pc.setLocalDescription(sdp);
          console.log("localDescription", pc.localDescription);
          let answerSDP = await _configure(sendJanusStream, {
            sessionId,
            handleId,
            roomId,
            jsep : sdp
          })
          await pc.setRemoteDescription(answerSDP.jsep);
          console.log("answerSDP")
          console.log(answerSDP)
        } catch (err) {
          console.error(err);
        }
        resolve();
      } catch (err) {
        console.error(err);
      }
    
    document.getElementById("btnReady").addEventListener("click", async e => {
      
    });
  };

  
});
const setting2 = (ws) => {
  let sendJanusStream = Pushable();
  let sessionId;
  let handleId;
  let keepaliveTimerId;
  let roomId;
  ws.onerror = console.error;
  ws.onclose = () => {
    console.log("CONNECTION CLOSED!");
    clearInterval(keepaliveTimerId)
  };

  ws.onopen = async () => {
    //setSendStream
    pull(
      sendJanusStream,
      stringify(),
      tap(o => console.log("[SENT]", o)),
      wsSink(ws)
    );
    //setReceiveStream
    pull(
      wsSource(ws),
      pull.map(o => JSON.parse(o)),
      tap(o => {
        if (o.janus !== "ack") console.log("[RECV] ", o);
      }),
      pull.drain(o =>{ 
        console.log(o)
        console.log(o.transaction);
        console.log(transactionQueue[o.transaction] );
        o && transactionQueue[o.transaction] && transactionQueue[o.transaction][o.janus](o)
      })
    );
    //init ws
      sessionId = await _createSession(sendJanusStream);
      handleId  = await _attach(sendJanusStream, sessionId);
      keepaliveTimerId = _startKeepAlive(sendJanusStream, sessionId, handleId);
      let result = await _join(sendJanusStream, {
        sessionId,
        handleId,
        roomId : window.roomInfo.roomId,
        broadcastId : window.roomInfo.publisherId,
        type : "subscriber"
      });
      console.log("subscriver")
      console.log(result)
    /*document.getElementById("btnReady").addEventListener("click", async e => {
      let joinedMsg = await _join(sendJanusStream, {
        sessionId,
        handleId,
        roomId,
        broadcastId : window.roomInfo.id,
        type : "subscriber"
      });
      pc = new RTCPeerConnection(null);
  
      // send any ice candidates to the other peer
      pc.onicecandidate = event => {
        console.log("[ICE]", event);
        if (event.candidate) {
          addIceCandidate(
            sendJanusStream,
            event.candidate,
            {
              sessionId,
              handleId
            }
          )
          // sendStream.push({
          //   request: "sendTrickleCandidate",
          //   candidate: event.candidate
          // });
        }
      };
      pc.oniceconnectionstatechange = function(e) {
        console.log("[ICE STATUS] ", pc.iceConnectionState);
      };
  
      // let the "negotiationneeded" event trigger offer generation
      pc.onnegotiationneeded = async () => {};
  
      try {
        // get a local stream, show it in a self-view and add it to be sent
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        document.getElementById("studio").srcObject = stream;
        try {
          let sdp = await pc.createOffer();
          await pc.setLocalDescription(sdp);
          console.log("localDescription", pc.localDescription);
          let answerSDP = await _configure(sendJanusStream, {
            sessionId,
            handleId,
            roomId,
            jsep : sdp
          })
          await pc.setRemoteDescription(answerSDP.jsep);
          console.log("answerSDP")
          console.log(answerSDP)
        } catch (err) {
          console.error(err);
        }
      } catch (err) {
        console.error(err);
      }
    
    });*/
  };


};
const initApp = async () => {
  console.log("init app");
  domReady.then(async ()=>{
    document.getElementById("btnReady").classList.remove("connecting");
    document.getElementById("btnReady").classList.remove("button-outline");
    window.jw1 = new WebSocket("ws://127.0.0.1:8188", "janus-protocol");
    
    await setting1( window.jw1);
    
    window.jw2 = new WebSocket("ws://127.0.0.1:8189", "janus-protocol");
    setting2( window.jw2);

    
  }).catch(console.error);

  //domReady.then(createNode).then(node => {
    

    /*node.handle("/streamer", (protocol, conn) => {
      document.getElementById("btnReady").classList.remove("connecting");
      document.getElementById("btnReady").classList.remove("button-outline");
      console.log("dialed!!");
      pull(sendStream, pull.map(o => JSON.stringify(o)), conn);
      pull(
        conn,
        pull.map(o => window.JSON.parse(o.toString())),
        pull.drain(o => {
          const controllerResponse = {
            answer: async desc => {
              console.log("controller answered", desc);
              await pc.setRemoteDescription(desc);
            }
          };
          controllerResponse[o.type] && controllerResponse[o.type](o);
        })
      );
    });
    node.on("peer:connect", peerInfo => {
      console.log("connected", peerInfo.id.toB58String());
    });
    node.start(err => {
      if (err) {
        console.error(err);
        return;
      }
      console.log(node.peerInfo.multiaddrs.toArray().map(o => o.toString()));
    });
  });*/
};
initApp();
