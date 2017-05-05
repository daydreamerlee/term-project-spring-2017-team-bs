const socketio = require('socket.io');

const db = require('../models/index.js')
const cards = require('../models/cards.js')
const gamecards = require('../models/gamecards.js')
const games = require('../models/games.js')
const hands = require('../models/hands.js')
const messages = require('../models/messages.js')
const users = require('../models/users.js')

const init = ( app, server ) => {
  const io = socketio( server )

  app.set( 'io', io )

  io.on( 'connection', function(socket) {
    console.log( 'A client connected to a game' );

    socket.on( 'disconnect', function(data) {
      console.log( 'A client disconnected from a game' );
    });

    socket.on('join-room', function(data) {
      socket.join(data.gameid);
    });

    socket.on('user-joined', function(info) {
      io.to(info.gameid).emit('user-joined', info);
    });

    socket.on('user-left', function(info, state) {
      state.players.filter(function(username) {
        return username != info.username;
      })
      gamecards.deleteUser(info.userid, info.gameid)
        .then(data => {
          return gamecards.findDistinctUsers(info.gameid)
        })
        .then(data1 => {
          if(data1.length <= 0) {
            return gamecards.deleteGame(info.gameid)
          } else {
            socket.to(info.gameid).emit('user-left', info);
            console.log('did not delete a game')
          }          
        })
        .then(() => {
          return games.deleteGame(info.gameid)
        })
        .then(() => {
          socket.to(info.gameid).emit('user-left', info);
          console.log('deleted a game')
        })
        .catch(err => {
          console.log(err)
        })
    });

    socket.on('message-send', function(data) {
      messages.add(data.gameid, data.userid, data.message)
        .then(() => {
          io.to(data.gameid).emit('message-send', data);
        })
        .catch(err => {
          console.log(err)
        })
    });

    socket.on('update-status', function(state) {
      games.findById(state.gameid)
        .then(data => {
          state.status = data.status;
          socket.emit('update-status', state);
        })
        .catch(err => {
          console.log(err)
        })
    })

    socket.on('update-number-of-players', function(state) {
      gamecards.findNumberOfUsers(state.gameid)
        .then(data => {
          state.numberOfPlayers = data[0].count
          socket.emit('update-number-of-players', state)
        })
        .catch(err => {
          console.log(err)
        })
    })

    socket.on('update-cards-in-deck', function(state) {
      gamecards.findCardsNotInPlay(state.gameid)
        .then(data => {
          state.cardsInDeck = data[0].count
          socket.emit('update-cards-in-deck', state)
        })
        .catch(err => {
          console.log(err)
        })
    })

    socket.on('update-players', function(state) {
      gamecards.findDistinctUsers(state.gameid)
        .then(data1 => {
          return Promise.all(data1.map(playerPromise))
        })
        .then(users => {
          state.players = users;
          socket.emit('update-players', state)
        })
        .catch(err => {
          console.log(err)
        })
    })

    socket.on('update-turn', function(state) {
      games.findById(state.gameid)
        .then(data1 => {
          return users.findById(data1.players_turn)
        })
        .then(data2 => {
          state.turn = data2.username;
          state.turnId = data2.userid;
          socket.emit('update-turn', state);
        })
        .catch(err => {
          console.log(err)
        })
    })

    socket.on('update-last-hand-called', function(state) {
      games.findById(state.gameid)
        .then(data1 => {
          state.lastHandCalledId = data1.last_hand_called;
          return hands.findById(data1.last_hand_called)
        })
        .then(data2 => {
          state.lastHandCalled = data2.description;
          socket.emit('update-last-hand-called', state);
        })
        .catch(err => {
          console.log(err)
        })
    })

    socket.on('update-cards', function(info, cards) {
      gamecards.findNumberOfCardsByUserId(info.gameid, info.userid)
        .then(data1 => {
          info.numberOfCards = data1[0].count;
          return gamecards.findCardsByUserId(info.gameid, info.userid)
        })
        .then(data2 => {
          cards = data2;
          socket.emit('update-cards', info, cards);
        })
        .catch(err => {
          console.log(err)
        })
    })

    socket.on('start', function(state) {
      games.changeStatus('in-progress', state.gameid)
        .then(() => {
          io.to(state.gameid).emit('start', state);
        })
        .catch(err => {
          console.log(err)
        })
    })

    socket.on('draw-cards', function(info) {
      gamecards.drawHandAndAdd(info.userid, info.gameid, info.numberOfCards)
        .then(cards => {
          socket.emit('draw-cards', cards);
        })
        .catch(err => {
          console.log(err)
        })
    })

    socket.on('call-hand', function(info, state, callQuantity, callRank) {
      state.lastHandCalled = '' + callQuantity + " " + callRank;
      hands.findByDescription(callQuantity + " " + callRank)
        .then(data => {
          if(data.handid <= state.lastHandCalledId) {
            socket.emit('call-hand-too-low')
            return new Promise(function(resolve, rejected) {
              resolve(true)
            })
          } else {
            state.lastHandCalledId = data.handid;
            return games.updateLastHandCalled(data.handid, state.gameid)
          }
        })
        .then(() => {
          io.to(state.gameid).emit('next-players-turn', info, state)
        })
        .catch(err => {
          console.log(err)
        })
    })

    socket.on('call-bs', function(info, state) {
      gamecards.findCardsInPlay(state.gameid)
        .then(cards => {
          return doesHandExist(cards, state.lastHandCalledId)
        })
        .then(exists => {
          console.log('exists ' + exists)
          if(exists)
            console.log('player who bsed loses a card')
          else
            console.log('player who got bsed loses a card')
          return gamecards.reset(state.gameid)
        })
        .then(() => {
          games.updateLastHandCalled(1, state.gameid)
          io.to(state.gameid).emit('new-round', info, state)
        })
        .catch(err => {
          console.log(err)
        })
    })

  });

};

function playerPromise(player) {
  return users.findById(player.userid)
}

function cardPromise(card) {
  return cards.findById(card.cardid)
}

function doesHandExist(cards, handid) {
  var exists = false;
  var fours = 0
  var fives = 0
  var sixes = 0
  var sevens = 0
  var eights = 0
  var nines = 0 
  var tens = 0 
  var jacks = 0
  var queens = 0
  var kings = 0
  var aces = 0
  var wilds = 0

  var cardPromises = cards.map(cardPromise);

  return Promise.all(cardPromises)
    .then(data => {
      for(var i=0; i<data.length; i++) {
        switch(data[i].rank) {
          case 4:
            fours++;
            break;
          case 5:
            fives++;
            break;
          case 6:
            sixes++;
            break;
          case 7:
            sevens++;
            break;
          case 8:
            eights++;
            break;
          case 9:
            nines++;
            break;
          case 10:
            tens++;
            break;
          case 11:
            jacks++;
            break;
          case 12:
            queens++;
            break;
          case 13:
            kings++;
            break;
          case 14:
            aces++;
            break;
        }
        if(data[i].wild)
          wilds++;

      }
      return new Promise(function(resolve, reject) {
        resolve(true)
      })
    })
    .then(() => {
      console.log('4s ' + fours)
      console.log('5s ' + fives)
      console.log('6s ' + sixes)
      console.log('7s ' + sevens)
      console.log('8s ' + eights)
      console.log('9s ' + nines)
      console.log('10s ' + tens)
      console.log('Js ' + jacks)
      console.log('Qs ' + queens)
      console.log('Ks ' + kings)
      console.log('As ' + aces)
      console.log('Ws ' + wilds)
      switch(handid) {
        case 1: //''
          console.log('error bsing blank')
          return true;
          break;
        case 2: //one 4
          if ((fours + wilds) >= 1)
            exists = true;
          break;
        case 3: //one 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 4: //one 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 5: //one 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 6: //one 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 7: //one 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 8: //one 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 9: //one J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 10: //one Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 11: //one K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 12: //one A
          if ((aces + wilds) >= 1)
            exists = true;
          break;
        case 13: //two 4
          if ((fours + wilds) >= 2)
            exists = true;
          break;
        case 14: //two 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 15: //two 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 16: //two 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 17: //two 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 18: //two 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 19: //two 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 20: //two J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 21: //two Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 22: //two K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 23: //two A
          if ((aces + wilds) >= 2)
            exists = true;
          break;
        case 24: //three 4
          if ((fours + wilds) >= 1)
            exists = true;
          break;
        case 25: //three 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 26: //three 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 27: //three 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 28: //three 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 29: //three 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 30: //three 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 31: //three J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 32: //three Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 33: //three K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 34: //three A
          if ((aces + wilds) >= 3)
            exists = true;
          break;
        case 35: //straight
          break;
        case 36: //flush D
          break;
        case 37: //flush C
          break;
        case 38: //flush H
          break;
        case 39: //flush S
          break;
        case 40: //full house 4
          break;
        case 41: //full house 5
          break;
        case 42: //full house 6
          break;
        case 43: //full house 7
          break;
        case 44: //full house 8
          break;
        case 45: //full house 9
          break;
        case 46: //full house 10
          break;
        case 47: //full house J
          break;
        case 48: //full house Q
          break;
        case 49: //full house K
          break;
        case 50: //full house A
          break;
        case 51: //four 4
          if ((fours + wilds) >= 1)
            exists = true;
          break;
        case 52: //four 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 53: //four 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 54: //four 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 55: //four 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 56: //four 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 57: //four 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 58: //four J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 59: //four Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 60: //four K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 61: //four A
          if ((aces + wilds) >= 4)
            exists = true;
          break;
        case 62: //straight flush
          break;
        case 63: //five 4
          if ((fours + wilds) >= 1)
            exists = true;
          break;
        case 64: //five 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 65: //five 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 66: //five 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 67: //five 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 68: //five 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 69: //five 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 70: //five J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 71: //five Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 72: //five K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 73: //five A
          if ((aces + wilds) >= 5)
            exists = true;
          break;
        case 74: //six 4
          if ((fours + wilds) >= 1)
            exists = true;
          break;
        case 75: //six 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 76: //six 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 77: //six 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 78: //six 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 79: //six 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 80: //six 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 81: //six J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 82: //six Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 83: //six K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 84: //six A
          if ((aces + wilds) >= 6)
            exists = true;
          break;
        case 85: //seven 4
          if ((fours + wilds) >= 1)
            exists = true;
          break;
        case 86: //seven 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 87: //seven 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 88: //seven 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 89: //seven 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 90: //seven 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 91: //seven 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 92: //seven J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 93: //seven Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 94: //seven K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 95: //seven A
          if ((aces + wilds) >= 7)
            exists = true;
          break;
        case 96: //eight 4
          if ((fours + wilds) >= 1)
            exists = true;
          break;
        case 97: //eight 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 98: //eight 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 99: //eight 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 100: //eight 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 101: //eight 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 102: //eight 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 103: //eight J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 104: //eight Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 105: //eight K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 106: //eight A
          if ((aces + wilds) >= 8)
            exists = true;
          break;
        case 107: //nine 4
          if ((fours + wilds) >= 1)
            exists = true;
          break;
        case 108: //nine 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 109: //nine 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 110: //nine 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 111: //nine 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 112: //nine 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 113: //nine 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 114: //nine J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 115: //nine Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 116: //nine K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 117: //nine A
          if ((aces + wilds) >= 9)
            exists = true;
          break;
        case 118: //ten 4
          if ((fours + wilds) >= 1)
            exists = true;
          break;
        case 119: //ten 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 120: //ten 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 121: //ten 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 122: //ten 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 123: //ten 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 124: //ten 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 125: //ten J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 126: //ten Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 127: //ten K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 128: //ten A
          if ((aces + wilds) >= 10)
            exists = true;
          break;
        case 129: //eleven 4
          if ((fours + wilds) >= 1)
            exists = true;
          break;
        case 130: //eleven 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 131: //eleven 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 132: //eleven 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 133: //eleven 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 134: //eleven 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 135: //eleven 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 136: //eleven J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 137: //eleven Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 138: //eleven K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 139: //eleven A
          if ((aces + wilds) >= 11)
            exists = true;
          break;
        case 140: //twelve 4
          if ((fours + wilds) >= 1)
            exists = true;
          break;
        case 141: //twelve 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 142: //twelve 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 143: //twelve 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 144: //twelve 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 145: //twelve 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 146: //twelve 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 147: //twelve J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 148: //twelve Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 149: //twelve K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 150: //twelve A
          if ((aces + wilds) >= 12)
            exists = true;
          break;
        case 151: //thirteen 4
          if ((fours + wilds) >= 1)
            exists = true;
          break;
        case 152: //thirteen 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 153: //thirteen 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 154: //thirteen 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 155: //thirteen 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 156: //thirteen 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 157: //thirteen 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 158: //thirteen J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 159: //thirteen Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 160: //thirteen K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 161: //thirteen A
          if ((aces + wilds) >= 13)
            exists = true;
          break;
        case 162: //fourteen 4
          if ((fours + wilds) >= 1)
            exists = true;
          break;
        case 163: //fourteen 5
          if ((fives + wilds) >= 1)
            exists = true;
          break;
        case 164: //fourteen 6
          if ((sixes + wilds) >= 1)
            exists = true;
          break;
        case 165: //fourteen 7
          if ((sevens + wilds) >= 1)
            exists = true;
          break;
        case 166: //fourteen 8
          if ((eights + wilds) >= 1)
            exists = true;
          break;
        case 167: //fourteen 9
          if ((nines + wilds) >= 1)
            exists = true;
          break;
        case 168: //fourteen 10
          if ((tens + wilds) >= 1)
            exists = true;
          break;
        case 169: //fourteen J
          if ((jacks + wilds) >= 1)
            exists = true;
          break;
        case 170: //fourteen Q
          if ((queens + wilds) >= 1)
            exists = true;
          break;
        case 171: //fourteen K
          if (kings + wilds >= 1)
            exists = true
          break;
        case 172: //fourteen A
          if ((aces + wilds) >= 14)
            exists = true;
          break;
      }
      return new Promise(function(resolve, reject) {
        resolve(exists)
      })
    })
}

module.exports = { init };