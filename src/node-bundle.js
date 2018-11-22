"use strict";

const libp2p = require("libp2p");
const WSStar = require("libp2p-websocket-star");

class Node extends libp2p {
  constructor(_options) {
    const wsStar = new WSStar({id: _options.peerInfo.id});
    const defaults = {
      modules: {
        transport: [wsStar],
        peerDiscovery: [wsStar.discovery]
      },
    };
    super(Object.assign(defaults, _options));
  }
}

module.exports = Node;
