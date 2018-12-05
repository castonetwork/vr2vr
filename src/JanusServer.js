import Pushable from "pull-pushable";
import Notify from "pull-notify";
const pull = require("pull-stream");
const { tap } = require("pull-tap");
const wsSource = require("pull-ws/source");
const wsSink = require("pull-ws");

const chance = require("chance").Chance();

const getSendSocketStream = (_sendStream, _notify) => {
  return (obj, resultHandler = {}) =>
    new Promise((resolve, reject) => {
      !resultHandler.failure && (resultHandler.failure = console.error);
      const transaction = chance.guid();
      console.log(`stream ${transaction}`);
      _sendStream.push({ ...obj, transaction });
      pull(
        _notify.listen(),
        pull.filter(o => o.transaction === transaction),
        pull.drain(obj => {
          if ("ack" !== obj.janus) {
            resolve(
              (resultHandler[obj.janus] && resultHandler[obj.janus](obj)) || obj
            );
          }
        })
      );
      /* TODO: success, failure */
    });
};

///broadcastObj : sessionId, handleId, sdpType, sdp
module.exports = websocket => {
  const sendStream = Pushable();
  const notify = Notify();
  const sendSocketStream = getSendSocketStream(sendStream, notify);
  pull(
    sendStream,
    pull.map(JSON.stringify),
    tap(o => console.log("[SENT]", o)),
    wsSink(websocket)
  );
  pull(
    wsSource(websocket),
    pull.map(o => JSON.parse(o)),
    pull.drain(o => {
      notify(o);
    })
  );
  return {
    sendStream,
    notify,
    _createSession: () =>
      sendSocketStream(
        { janus: "create" },
        {
          success: res => res && res.data && res.data.id
        }
      ),

    _attach: sessionId => {
      return sendSocketStream(
        {
          janus: "attach",
          session_id: sessionId,
          plugin: "janus.plugin.videoroom"
        },
        {
          success: res => res && res.data && res.data.id
        }
      );
    },
    createRoom: (sessionId, handleId) => {
      let request = {
        janus: "message",
        session_id: sessionId,
        handle_id: handleId,
        body: {
          request: "create",
          description: "casto",
          bitrate: 1024000,
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

      return sendSocketStream(request, {
        success: res =>
          res &&
          res.plugindata &&
          res.plugindata.data &&
          res.plugindata.data.room
      });
    },
    _join: broadcastObj => {
      if (broadcastObj.type === "subscriber" && !broadcastObj)
        console.error("No broadCast info");
      let request = {
        janus: "message",
        session_id: broadcastObj.sessionId,
        handle_id: broadcastObj.handleId,
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
      return sendSocketStream(request, {
        ask: res => {},
        event: res => {
          if ("error_code" in res.plugindata.data) {
            return (
              "cmd:join " +
              " code:" +
              res.plugindata.data.error_code +
              ":" +
              " message:" +
              res.plugindata.data.error
            );
          } else {
            return res;
          }
        }
      });
    },
    _startKeepAlive: (sessionId, handleId) => {
      return sendSocketStream(
        {
          janus: "keepalive",
          session_id: sessionId,
          handle_id: handleId
        },
        {
          ack: res => {}
        }
      );
    },
    _configure: broadcastObj => {
      let request = {
        janus: "message",
        session_id: broadcastObj.sessionId,
        handle_id: broadcastObj.handleId,
        body: {
          request: "configure",
          room: broadcastObj.roomId,
          ptype: "publisher",
          video: true,
          audio: true
        },
        jsep: broadcastObj.jsep
      };
      return sendSocketStream(request, {
        ask: res => {},
        event: res => {
          if ("error_code" in res.plugindata.data) {
            return (
              "cmd:join " +
              " code:" +
              res.plugindata.data.error_code +
              ":" +
              " message:" +
              res.plugindata.data.error
            );
          } else {
            return res;
          }
        }
      });
    },
    addIceCandidate: (candidates, broadcastObj) => {
      const { sdpMid, sdpMLineIndex, candidate } = candidates;
      let request = {
        janus: "trickle",
        session_id: broadcastObj.sessionId,
        handle_id: broadcastObj.handleId,
        candidate: {
          sdpMid: sdpMid,
          sdpMLineIndex: sdpMLineIndex,
          candidate: candidate
        }
      };
      return sendSocketStream(request, {
        ask: res => {}
      });
    },
    _start: broadcastObj => {
      let request = {
        janus: "message",
        session_id: broadcastObj.sessionId,
        handle_id: broadcastObj.handleId,
        body: {
          request: "start",
          room: broadcastObj.roomId
        },
        jsep: broadcastObj.jsep
      };
      return sendSocketStream(request, {
        ask: res => {},
        event: res => {
          if ("error_code" in res.plugindata.data) {
            return (
              "cmd:join " +
              " code:" +
              res.plugindata.data.error_code +
              ":" +
              " message:" +
              res.plugindata.data.error
            );
          } else {
            return res;
          }
        }
      });
    }
  };
};
