import "babel-polyfill";
import Promise from "es6-promise";
const pull = require("pull-stream");
const Pushable = require("pull-pushable");
const { tap } = require("pull-tap");
const wsSource = require("pull-ws/source");
const wsSink = require("pull-ws");

const stringify = require("pull-stringify");
let transactionQueue = {};
let pc;
const chance = require("chance").Chance();

const domReady = new Promise((resolve, reject) => {
  console.log("DOM ready");

  resolve();
});

const _createSession = janusStream => {
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

const _attach = (janusStream, sessionId) => {
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
};

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
};
const createRoom = (janusStream, sessionId, handleId) => {
  let tId = chance.guid();
  let request = {
    janus: "message",
    session_id: sessionId,
    handle_id: handleId,
    transaction: tId,
    body: {
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
};

const _join = (sendJanusStream, broadcastObj) => {
  console.log("_join", broadcastObj);
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
        console.log("Join ack");
      },
      event: response => {
        console.log("Join evnt");
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
          console.log("Join event", response);
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
};
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
    jsep: broadcastObj.jsep
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
};
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
};
const _start = (sendJanusStream, broadCastObj) => {
  let tId = chance.guid();
  let request = {
    janus: "message",
    session_id: broadCastObj.sessionId,
    handle_id: broadCastObj.handleId,
    transaction: tId,
    body: {
      request: "start",
      room: broadCastObj.roomId
    },
    jsep: broadCastObj.jsep
  };

  sendJanusStream.push(request);
};

const initApp = async () => {
  console.log("init app");
  domReady
    .then(async () => {
      document.getElementById("btnReady").classList.remove("connecting");
      document.getElementById("btnReady").classList.remove("button-outline");

      let jw1 = new WebSocket("ws://127.0.0.1:8188", "janus-protocol");
      let sendJanus1Stream = Pushable();
      let jw1Obj = {};
      await new Promise((resolve, reject) => {
        jw1.onerror = console.error;
        jw1.onclose = () => {
          console.log("CONNECTION CLOSED!");
          clearInterval(jw1Obj.keepaliveTimerId);
        };

        jw1.onopen = async () => {
          //setSendStream
          pull(
            sendJanus1Stream,
            stringify(),
            tap(o => console.log("[SENT]", o)),
            wsSink(jw1)
          );
          //setReceiveStream
          pull(
            wsSource(jw1),
            pull.map(o => JSON.parse(o)),
            tap(o => {
              if (o.janus !== "ack") console.log("[RECV] ", o);
            }),
            pull.drain(o => {
              o &&
                transactionQueue[o.transaction] &&
                transactionQueue[o.transaction][o.janus](o);
            })
          );
          resolve();
        };
      });

      //init ws
      jw1Obj.sessionId = await _createSession(sendJanus1Stream);
      jw1Obj.handleId = await _attach(sendJanus1Stream, jw1Obj.sessionId);
      jw1Obj.keepaliveTimerId = _startKeepAlive(
        sendJanus1Stream,
        jw1Obj.sessionId,
        jw1Obj.handleId
      );
      jw1Obj.roomId = await createRoom(
        sendJanus1Stream,
        jw1Obj.sessionId,
        jw1Obj.handleId
      );
      jw1Obj.type = "publisher";
      let joinedInfo = await _join(sendJanus1Stream, jw1Obj);
      jw1Obj.broadcastId = joinedInfo.plugindata.data.id;
      pc = new RTCPeerConnection(null);
      // send any ice candidates to the other peer
      pc.onicecandidate = event => {
        console.log("[ICE]", event);
        if (event.candidate) {
          addIceCandidate(sendJanus1Stream, event.candidate, jw1Obj);
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
          jw1Obj.jsep = sdp;
          let answerSDP = await _configure(sendJanus1Stream, jw1Obj);
          await pc.setRemoteDescription(answerSDP.jsep);
          console.log(answerSDP);
        } catch (err) {
          console.error(err);
        }
      } catch (err) {
        console.error(err);
      }

      //init janusWebsocket2
      let jw2 = new WebSocket("ws://127.0.0.1:8189", "janus-protocol");
      let sendJanus2Stream = Pushable();
      let jw2Obj = {};
      await new Promise((resolve, reject) => {
        jw2.onerror = console.error;
        jw2.onclose = () => {
          console.log("CONNECTION CLOSED!");
          clearInterval(jw2Obj.keepaliveTimerId);
        };

        jw2.onopen = async () => {
          //setSendStream
          pull(
            sendJanus2Stream,
            stringify(),
            tap(o => console.log("[SENT]", o)),
            wsSink(jw2)
          );
          //setReceiveStream
          pull(
            wsSource(jw2),
            pull.map(o => JSON.parse(o)),
            tap(o => {
              if (o.janus !== "ack") console.log("[RECV] ", o);
            }),
            pull.drain(o => {
              o &&
                transactionQueue[o.transaction] &&
                transactionQueue[o.transaction][o.janus](o);
            })
          );
          resolve();
        };
      });
      //init ws
      jw2Obj.sessionId = await _createSession(sendJanus2Stream);
      jw2Obj.handleId = await _attach(sendJanus2Stream, jw2Obj.sessionId);
      jw2Obj.keepaliveTimerId = _startKeepAlive(
        sendJanus2Stream,
        jw2Obj.sessionId,
        jw2Obj.handleId
      );
      jw2Obj.roomId = await createRoom(
        sendJanus2Stream,
        jw2Obj.sessionId,
        jw2Obj.handleId
      );
      jw2Obj.type = "publisher";
      let joinedInfo2 = await _join(sendJanus2Stream, jw2Obj);
      jw2Obj.broadcastId = joinedInfo2.plugindata.data.id;

      //get offerSDP from jw1
      let jw1Obj2 = {};
      jw1Obj2.handleId = await _attach(sendJanus1Stream, jw1Obj.sessionId);
      jw1Obj2.keepaliveTimerId = _startKeepAlive(
        sendJanus1Stream,
        jw1Obj.sessionId,
        jw1Obj2.handleId
      );

      let subscriberJoined = await _join(sendJanus1Stream, {
        sessionId: jw1Obj.sessionId,
        handleId: jw1Obj2.handleId,
        roomId: jw1Obj.roomId,
        broadcastId: jw1Obj.broadcastId,
        type: "subscriber"
      });

      let offerSDPtoJw2 = subscriberJoined.jsep;

      let jw2Configured = await _configure(sendJanus2Stream, {
        sessionId: jw2Obj.sessionId,
        handleId: jw2Obj.handleId,
        roomId: jw2Obj.roomId,
        jsep: offerSDPtoJw2
      });
      console.log("getSubscriber");
      console.log(answerSDPtoJw1);
      let answerSDPtoJw1 = jw2Configured.jsep;
      _start(sendJanus1Stream, {
        sessionId: jw1Obj.sessionId,
        handleId: jw1Obj2.handleId,
        roomId: jw1Obj.roomId,
        jsep: answerSDPtoJw1
      });
    })
    .catch(console.error);
};
initApp();
