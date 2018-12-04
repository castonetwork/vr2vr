import "babel-polyfill";
const JanusServer = require("./JanusServer");

const domReady = new Promise((resolve, reject) => {
  console.log("DOM ready");
  resolve();
});

const makeJanusServer = async ws => {
  let janusServer = await new Promise((resolve, reject) => {
    ws.onerror = console.error;
    ws.onclose = () => {
      console.log("CONNECTION CLOSED!");
      clearInterval(publisher.keepaliveTimerId);
    };

    ws.onopen = async () => {
      //setSendStream
      let janusServer = JanusServer(ws);
      console.log("success setting websocket");
      resolve(janusServer);
    };
  });
  return janusServer;
};

const makePublisher = async janusServer => {
  //init ws
  let publisher = {};
  publisher.sessionId = await janusServer._createSession();
  publisher.handleId = await janusServer._attach(publisher.sessionId);
  publisher.keepaliveTimerId = setInterval(x => {
    janusServer._startKeepAlive(publisher.sessionId, publisher.handleId);
  }, 30000);
  console.log("keepalive");
  console.log(publisher.keepaliveTimerId);
  publisher.roomId = await janusServer.createRoom(
    publisher.sessionId,
    publisher.handleId
  );
  publisher.type = "publisher";
  let joinedInfo = await janusServer._join(publisher);
  console.log(joinedInfo);
  publisher.broadcastId = joinedInfo.plugindata.data.id;
  return { ...publisher, janusServer };
};

const makeViewer = async publisher => {
  let viewer = {};
  viewer.sessionId = publisher.sessionId;
  viewer.handleId = await publisher.janusServer._attach(publisher.sessionId);
  viewer.keepaliveTimerId = setInterval(x => {
    publisher.janusServer._startKeepAlive(viewer.sessionId, viewer.handleId);
  }, 30000);

  return { ...viewer, janusServer: publisher.janusServer };
};

//const getPcForPublish
const startPublishStream = async publisher => {
  let janusServer = publisher.janusServer;
  publisher.pc = new RTCPeerConnection(null);
  // send any ice candidates to the other peer
  publisher.pc.onicecandidate = event => {
    console.log("[ICE]", event);
    if (event.candidate) {
      janusServer.addIceCandidate(event.candidate, publisher);
    }
  };
  publisher.pc.oniceconnectionstatechange = function(e) {
    console.log("[ICE STATUS] ", publisher.pc.iceConnectionState);
  };

  // let the "negotiationneeded" event trigger offer generation
  publisher.pc.onnegotiationneeded = async () => {};

  try {
    // get a local stream, show it in a self-view and add it to be sent
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    });
    stream.getTracks().forEach(track => publisher.pc.addTrack(track, stream));
    let sdp = await publisher.pc.createOffer();
    await publisher.pc.setLocalDescription(sdp);
    publisher.jsep = sdp;

    let answerSDP = await janusServer._configure(publisher);
    await publisher.pc.setRemoteDescription(answerSDP.jsep);

    document.getElementById("studio").srcObject = stream;
  } catch (err) {
    console.error(err);
  }
};
const relayPublisher = async (originPublisher, relayPublisher) => {
  let viewer = await makeViewer(originPublisher);

  let originOfferSDP = await viewer.janusServer._join({
    sessionId: viewer.sessionId,
    handleId: viewer.handleId,
    roomId: originPublisher.roomId,
    broadcastId: originPublisher.broadcastId,
    type: "subscriber"
  });
  originOfferSDP.jsep.trickle = false;
  let releyAnswerSDP = await relayPublisher.janusServer._configure({
    sessionId: relayPublisher.sessionId,
    handleId: relayPublisher.handleId,
    roomId: relayPublisher.roomId,
    jsep: originOfferSDP.jsep
  });
  console.log("releyAnswerSDP");
  console.log(releyAnswerSDP);
  releyAnswerSDP.jsep.trickle = false;
  await viewer.janusServer._start({
    sessionId: viewer.sessionId,
    handleId: viewer.handleId,
    roomId: originPublisher.roomId,
    jsep: releyAnswerSDP.jsep
  });
};

const startViewStream = async (publisher, eleId) => {
  let viewer = await makeViewer(publisher);

  let pc = new RTCPeerConnection(null);

  pc.onicecandidate = event => {
    console.log("[ICE]", event);
    if (event.candidate) {
      viewer.janusServer.addIceCandidate(event.candidate, {
        sessionId: viewer.sessionId,
        handleId: viewer.handleId
      });
    }
  };

  pc.oniceconnectionstatechange = function(e) {
    console.log("[ICE STATUS_VIEWER] ", pc.iceConnectionState);
  };
  // let the "negotiationneeded" event trigger offer generation
  pc.ontrack = async event => {
    console.log("[ON TRACK_VIEWER]", event);
    console.log(event);
    //event.streams.forEach(track => pc.addTrack(track, stream));
    document.getElementById(eleId).srcObject = event.streams[0];
  };

  try {
    let publisherOfferSDP = await viewer.janusServer._join({
      sessionId: viewer.sessionId,
      handleId: viewer.handleId,
      roomId: publisher.roomId,
      broadcastId: publisher.broadcastId,
      type: "subscriber"
    });
    await pc.setRemoteDescription(publisherOfferSDP.jsep);
    let answerSDP = await pc.createAnswer();
    console.log(answerSDP);
    await pc.setLocalDescription(answerSDP);
    await viewer.janusServer._start({
      sessionId: viewer.sessionId,
      handleId: viewer.handleId,
      roomId: publisher.roomId,
      jsep: answerSDP
    });
  } catch (err) {
    console.error(err);
  }
};

const initApp = async () => {
  console.log("init app");
  domReady
    .then(async () => {
      document.getElementById("btnReady").classList.remove("connecting");
      document.getElementById("btnReady").classList.remove("button-outline");

      let jw1 = new WebSocket("ws://127.0.0.1:8188", "janus-protocol");
      let janusServer1 = await makeJanusServer(jw1);
      let publisher1 = await makePublisher(janusServer1);

      //
      let jw2 = new WebSocket("ws://127.0.0.1:8189", "janus-protocol");
      let janusServer2 = await makeJanusServer(jw2);
      let publisher2 = await makePublisher(janusServer2);

      let jw3 = new WebSocket("ws://13.209.96.83:8188", "janus-protocol");
      let janusServer3 = await makeJanusServer(jw3);
      let publisher3 = await makePublisher(janusServer3);

      await startPublishStream(publisher1);
      await relayPublisher(publisher1, publisher2);
      await relayPublisher(publisher1, publisher3);
      await startViewStream(publisher2, "viewer1");
      await startViewStream(publisher3, "viewer2");
    })
    .catch(console.error);
};
initApp();
