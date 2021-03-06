/**
 * Date: 2019/2/21
 * Author: admin
 * Description: 跑得快牌桌管理
 */
let pomelo = require('pomelo');
let util = require('util');
let Entity = _require('./entity');
let consts = require('../common/consts');
let messageService = _require('../services/messageService');
let pdkHelper = _require('../helper/pdkHelper');
let utils = _require('../util/utils');
let pdkAIHelper = _require('../helper/pdkAIHelper');
let stageCfg = _require('../common/stage');
let common = require('../common/common');

let GoldEntity = function (opts) {
    opts = opts || {};
	Entity.call(this, opts);
	this.roomInfo = {};  // 房间信息
	this.autoSchedule = null; 
	this.initGoldRoom(opts.usrInfo, opts.gameType, opts.stage);
};

util.inherits(GoldEntity, Entity);
module.exports = GoldEntity;

let pro = GoldEntity.prototype;

pro.initGoldRoom = function (usrInfo, gameType, stage) {
    this.roomInfo = {
        roomid: this.id,
		creator: usrInfo.id,
		createTime: Math.ceil(Date.now()/1000),
		status: consts.TableStatus.INIT,
		gameType: gameType || consts.GameType.PDK_16,
		stage: stage,
		underScore: stageCfg[gameType][stage].underScore,
		players: {},
		//游戏开始卡牌信息
		cardInfo:{
			handCardData: [0, 0, 0],   	//手牌
			cardCount: [0, 0, 0],      	//手牌数量
			currentUser: 0,     		//当前出牌用户
			turnCardCount: 0,   		//上回合出牌张数
			turnCardData:[],    		//上回合出牌数据
			turnUser: consts.InvalUser, 	//上回合用户
			bUserWarn: [false, false, false] //是否报警
		},
	};
	this.addUserToPlayers(usrInfo, 0);

	if (gameType == consts.GameType.PDK_15) {
		this.roomInfo.maxCardCount = 15;
	} else {
		this.roomInfo.maxCardCount = 16;
	}
};

// 进入房间返回客户端数据
pro.clientEnterInfo = function (uid) {
	let wChairID = this._getChairIDByUid(uid)
	let roomInfo = utils.clone(this.roomInfo);
	roomInfo.cardInfo.handCardData = roomInfo.cardInfo.handCardData[wChairID];
	return roomInfo;
};

pro._getChairIDByUid = function (uid) {
	let players = this.roomInfo.players;
	for (const key in players) {
		if (players.hasOwnProperty(key)) {
			const user = players[key];
			if (uid == user.id) {
				return user.chairID;
			}
		}
	}
};

pro._getUidByChairID = function (chairID) {
	let players = this.roomInfo.players;
	for (const key in players) {
		if (players.hasOwnProperty(key)) {
			const user = players[key];
			if (chairID == user.chairID) {
				return user.id;
			}
		}
	}
};

pro.checkFullMember = function () {
	let players = Object.keys(this.roomInfo.players);
	let len = players.length;
	if (len >= 3) {
		return true;
	}
	return false;
};

pro.checkRooming = function (uid) {
    let players = this.roomInfo.players;
	for (const key in players) {
		if (players.hasOwnProperty(key)) {
			const user = players[key];
			if (uid == user.id) {
				return true;
			}
		}
    }
    return false;
};

pro.addUserToPlayers = function (usrInfo, chairID) {
	if (!(chairID >= 0 && chairID < 3)) {
		this.logger.error('add user chairId error', chairID);
		return;
	}

	let playerInfo = {
		id: usrInfo.id,
		name: usrInfo.name,
		gender: usrInfo.gender,
		avatarUrl: usrInfo.avatarUrl,
		coins: usrInfo.coins,
		gems: usrInfo.gems,
		chairID: chairID,
		readyState: consts.ReadyState.Ready_No,
		preSid: usrInfo.preSid,
		autoState: consts.AutoState.AutoNo,
		openid: usrInfo.openid
	};
	this.roomInfo.players[chairID] = playerInfo;
};

pro.removeUserInPlayers = function (uid) {
	let players = this.roomInfo.players;
	for (const key in players) {
		if (players.hasOwnProperty(key)) {
			const user = players[key];
			if (uid == user.id) {
				delete players[key];
				break;
			}
		}
	}
};

pro.updateUserToPlayers = function (usrInfo) {
	let isExist = false;
	let players = this.roomInfo.players;
	for (const key in players) {
		if (players.hasOwnProperty(key)) {
			const user = players[key];
			if (usrInfo.id == user.id) {
				user.coins = usrInfo.coins;
				user.gems = usrInfo.gems;
				isExist = true;
				break;
			}
		}
	}

	if (!isExist) {
		let chairID = this.getEnterPlayerChairID();
		this.addUserToPlayers(usrInfo, chairID);
	}
};

pro.getEnterPlayerChairID = function () {
	let players = this.roomInfo.players;
	for (let i = 0; i < 3; i++) {
		if (!players.hasOwnProperty(i)) {
			return i;
		}
	}
	this.logger.error('getEnterPlayerChairID error = ', players);
};

pro.getPlayerReadyCount = function () {
	let players = this.roomInfo.players;
	let count = 0;
	for (const key in players) {
		if (players.hasOwnProperty(key)) {
			const user = players[key];
			if (user.readyState === consts.ReadyState.Ready_Yes) {
				count = count + 1;
			}
		}
	}
	return count;
};

pro.readyGame = function (uid, next) {
	let roomState = this.roomInfo.status;
	if (roomState == consts.TableStatus.START) {
		utils.invokeCallback(next, null, {code: consts.ReadyGameCode.GAME_STARTED});
	} else if (!this._checkCoins(uid)) {
		// 金币不足判断
		utils.invokeCallback(next, null, {code: consts.ReadyGameCode.COINS_LESS});
	} else {
		utils.invokeCallback(next, null, {code: consts.ReadyGameCode.OK});
		this.setPlayerReadyState(uid, consts.ReadyState.Ready_Yes);
		// 推送准备状态
		let route = 'onReadyGame';
		let msg = {wChairID: this._getChairIDByUid(uid)};
		this._notifyMsgToOtherMem(null, route, msg);
		let readyCount = this.getPlayerReadyCount();
		if (readyCount >= 3) {
			// 游戏开始
			this.roomInfo.status = consts.TableStatus.START;
			setTimeout(function () {
				this._startGame();
			}.bind(this), 1000);
		}
	}
};

pro._checkCoins = function (uid) {
	let cfg = stageCfg[this.roomInfo.gameType][this.roomInfo.stage];
	let wChairID = this._getChairIDByUid(uid);
	let curCoins = this.roomInfo.players[wChairID].coins;
	if (cfg.eArea < 0) {
		if (curCoins >= cfg.bArea) {
			return true;
		}
	} else {
		if (curCoins >= cfg.bArea && curCoins <= cfg.eArea) {
			return true;
		}
	}
	return false;
};

// uid 为空设置所有玩家
pro.setPlayerReadyState = function (uid, state) {
	let players = this.roomInfo.players;
	if (uid) {
		let wChairID = this._getChairIDByUid(uid);
		this.roomInfo.players[wChairID].readyState = state;
	} else {
		for (const key in players) {
			if (players.hasOwnProperty(key)) {
				players[key].readyState = state;
			}
		}
	}
};

// 游戏开始
pro._startGame = function () {
	// 洗牌
	if (this.roomInfo.stage == 0) {
		var cardData = pdkHelper.RandCardList(this.roomInfo.gameType);
	} else if(this.roomInfo.stage == 1) {
		var cardData = pdkHelper.RandCardList2(this.roomInfo.gameType);
	} else {
		var cardData = pdkHelper.RandCardList3(this.roomInfo.gameType);
	}

	// 配牌
	// cardData = [
	// 	2, 1, 45, 13, 58, 26, 10, 57, 41, 25, 7, 22, 6, 53, 37,
	// 	29, 43, 27, 11, 42, 55, 39, 23, 54, 36, 4, 51, 35, 19, 3,
	// 	60, 44, 28, 12, 59, 9, 56, 40, 24, 8, 38, 21, 5, 52, 20,
	// ];

	//发牌
	var handCardData = [];
	var pos = 0
	for (let i = 0; i < 3; i++) {
		let onearr = cardData.slice(pos, pos + this.roomInfo.maxCardCount);
		handCardData.push(onearr);
		pos = pos + this.roomInfo.maxCardCount;
		pdkHelper.SortCardList(handCardData[i], this.roomInfo.maxCardCount);
		this.roomInfo.cardInfo.handCardData[i] = onearr;
		this.roomInfo.cardInfo.cardCount[i] = this.roomInfo.maxCardCount;
	}
	this.logger.info('玩家手牌数据:', handCardData);

    // 黑桃3先出
    var banker = this._getBankerUser(handCardData, 3);
    this.roomInfo.cardInfo.currentUser = banker;
	
	// 游戏开始,通知发牌
	let players = this.roomInfo.players;
	for (const key in players) {
		if (players.hasOwnProperty(key)) {
			const user = players[key];
			let sid = user.preSid;
			let route = 'onStartGame';
			let msg = {
				wCurrentUser: banker,
				cbCardData: handCardData[key],
				wChairID: key
			}
			let uids = [{
				uid: user.id,
				sid: sid
			}]
			messageService.pushMessageByUids(uids, route, msg);
			this.logger.info("name[%s] sid[%s] msg[%s]", user.name, sid, route);
		}
	}
	this._startAutoSchedule(20, 0.5);
};

// 获取庄家[cbCard:这个牌先出]
pro._getBankerUser = function(handCardData, cbCard)
{
	for (let i =0;i < 3;i++)
	{
		for (let j =0; j < this.roomInfo.maxCardCount;j++)
		{
			if (handCardData[i][j] == cbCard)
			{
				return i;
			}
		}
	}
	return consts.InvalUser;
};

// 出牌(参数为空是托管AI出牌)
pro.playCard = function(uid, bCardData, bCardCount, next) {
	let cardInfo = this.roomInfo.cardInfo;
	let playerCount = 3;
	let wChairID = null;
	if (uid) {
		wChairID = this._getChairIDByUid(uid);
	} else {
		// 托管AI出牌
		wChairID = cardInfo.currentUser;
		if (wChairID == cardInfo.turnUser) {
			cardInfo.turnCardData = [];
		}
		let handCardData = cardInfo.handCardData[wChairID];
		let turnCardData = cardInfo.turnCardData;
		let bNextWarn = cardInfo.bUserWarn[(wChairID+1)%playerCount];
		let outCard = pdkAIHelper.AISearchOutCard(handCardData, turnCardData, bNextWarn);
		if (!outCard) {
			// 要不起
			utils.invokeCallback(next, null, {code: consts.PlayCardCode.OUT_CARD_TYPE_ERROR});
			this._broadcastHandCardMsg(wChairID);
			return;
		}
		bCardData = outCard.bCardData;
		bCardCount = outCard.bCardCount;
	}
	if (!bCardData) {
		utils.invokeCallback(next, null, {code: consts.PlayCardCode.OUT_CARD_TYPE_ERROR});
		this._broadcastHandCardMsg(wChairID);
		return;
	}
	bCardData = bCardData.slice(0, bCardCount);

	// 是否轮到出牌
	if (wChairID != cardInfo.currentUser) {
		this.logger.warn('wChairID[%d] currentUser[%d] no equiel!',wChairID, cardInfo.currentUser);
		utils.invokeCallback(next, null, {code: consts.PlayCardCode.NO_TURN_OUT_CARD});
		this._broadcastHandCardMsg(wChairID);
		return;
	}

	// 检测出牌类型
	let bCardType = 0;
	if (cardInfo.cardCount[wChairID] != bCardCount) {
		bCardType = pdkHelper.GetCardType(bCardData, bCardCount);
	} else {
		bCardType = pdkHelper.GetLastCardType(bCardData,bCardCount);
	}
	if(bCardType == pdkHelper.CardType.CT_ERROR) 
	{
		utils.invokeCallback(next, null, {code: consts.PlayCardCode.OUT_CARD_TYPE_ERROR});
		this._broadcastHandCardMsg(wChairID);
		return;
	}

	// 出牌排序
	pdkHelper.SortCardList(bCardData, bCardCount);

	// 跟随出牌
	if (cardInfo.turnCardCount != 0 && wChairID != cardInfo.turnUser) {
		if (cardInfo.cardCount[wChairID] != bCardCount) {
			if (pdkHelper.CompareCard(cardInfo.turnCardData,bCardData,cardInfo.turnCardCount,bCardCount)==false) {
				utils.invokeCallback(next, null, {code: consts.PlayCardCode.OUT_CARD_TYPE_ERROR});
				this._broadcastHandCardMsg(wChairID);
				return;
			}
		} else {
			if (pdkHelper.CompareLastCard(cardInfo.turnCardData,bCardData,cardInfo.turnCardCount,bCardCount)==false)
			{
				utils.invokeCallback(next, null, {code: consts.PlayCardCode.OUT_CARD_TYPE_ERROR});
				this._broadcastHandCardMsg(wChairID);
				return;
			}
		}
	}

	//报警必须出最大牌
	if (cardInfo.bUserWarn[(wChairID+1)%playerCount]==true && bCardCount==1)
	{
		pdkHelper.SortCardList(cardInfo.handCardData[wChairID],cardInfo.cardCount[wChairID]);
		if (pdkHelper.GetCardLogicValue(cardInfo.handCardData[wChairID][0]) != pdkHelper.GetCardLogicValue(bCardData[0]))
		{
			utils.invokeCallback(next, null, {code: consts.PlayCardCode.OUT_CARD_TYPE_ERROR});
			this._broadcastHandCardMsg(wChairID);
			return;
		}
	}

	// 删除扑克
	if(pdkHelper.RemoveCard(bCardData,bCardCount,cardInfo.handCardData[wChairID],cardInfo.cardCount[wChairID]) == false)
	{
		utils.invokeCallback(next, null, {code: consts.PlayCardCode.REMOVE_CARD_ERROR});
		this._broadcastHandCardMsg(wChairID);
		this.logger.error(bCardData,bCardCount,cardInfo.handCardData[wChairID],cardInfo.cardCount[wChairID]);
		return;
	}
	utils.invokeCallback(next, null, {code: consts.PlayCardCode.OK});

	// 出牌记录
	cardInfo.cardCount[wChairID]-=bCardCount;
	cardInfo.turnCardCount=bCardCount;
	cardInfo.turnCardData=bCardData.slice(0);
	cardInfo.turnUser=wChairID;

	// 切换用户
	if (cardInfo.cardCount[wChairID]!=0)
		cardInfo.currentUser=(cardInfo.currentUser+1) % playerCount;
	else
		cardInfo.currentUser = consts.InvalUser;

	// 发送自己当前剩余手牌
	this._broadcastHandCardMsg(wChairID);

	// 报单消息
	if (cardInfo.cardCount[wChairID]==1) {
		this._broadcastSingCardMsg(wChairID);
	}

	// 出牌消息
	this._broadcastOutCardMsg(wChairID, bCardData, bCardCount, cardInfo.currentUser);
	this.logger.info('当前:[%d](%s), 出牌:', wChairID, this.roomInfo.players[wChairID].name, bCardData);

	// 炸弹扣分
	if (bCardType == pdkHelper.CardType.CT_BOMB_CARD) {
		let underScore = stageCfg[this.roomInfo.gameType][this.roomInfo.stage].underScore;
		let bombData = this._getBombCoins(wChairID, 5 * underScore);
		let changes = bombData.changes;
		let remains = bombData.remains;
		this._broadcastRefreshCoins(remains, changes);
	}

	if (cardInfo.currentUser == consts.InvalUser) {
		this.logger.info('赢家: [%d](%s), 出牌:', wChairID, this.roomInfo.players[wChairID].name, bCardData);
		// 重置房间数据
		this._resetRoomData();
		// 结算消息
		let settleData = this._getSettlementCoins(wChairID);
		let changes = settleData.changes;
		let remains = settleData.remains;
		this._broadcastSettlementMsg(wChairID, changes);
		this._broadcastRefreshCoins(remains, changes);
		this._updateWinOrFailCount(this.roomInfo.players[wChairID].id);

	} else {
		// 要不起自动下一手
		this._checkNextOutCard(wChairID, cardInfo.currentUser);
	}
};

// 重置房间数据
pro._resetRoomData = function () {
	this.roomInfo.status = consts.TableStatus.INIT;
	this.roomInfo.cardInfo.turnCardData = [];
	this.roomInfo.cardInfo.turnCardCount = 0;
	this.roomInfo.cardInfo.turnUser = consts.InvalUser;
	this.roomInfo.cardInfo.bUserWarn = [false, false, false];
	this.setPlayerReadyState(null, consts.ReadyState.Ready_No);
	this._setAutoState(null, consts.AutoState.AutoNo);
	this._stopAutoSchedul();
};

// 结算金币
pro._getSettlementCoins = function (winUser) {
	let changes = [];
	let remains = [];
	let handCard = this.roomInfo.cardInfo.handCardData;
	let underScore = stageCfg[this.roomInfo.gameType][this.roomInfo.stage].underScore;
	let winCoins = 0;
	for (let i = 0; i < handCard.length; i++) {
		let data = handCard[i] || [];
		let lessCoins = data.length * underScore;  // 扣币 = 牌张数 * 底分
		if (data.length == this.roomInfo.maxCardCount) {
			// 春天翻倍
			lessCoins = lessCoins * 2;
		} else if (data.length == 1) {
			// 报单不扣
			lessCoins = 0;
		}
		let curCoins = this.roomInfo.players[i].coins;
		lessCoins = ((lessCoins > curCoins) ? curCoins : lessCoins);
		this.roomInfo.players[i].coins = curCoins - lessCoins;
		winCoins = winCoins + lessCoins;
		changes.push(-lessCoins);
		remains.push(this.roomInfo.players[i].coins);
	}
	changes[winUser] = winCoins;
	this.roomInfo.players[winUser].coins = this.roomInfo.players[winUser].coins + winCoins;
	remains[winUser] = this.roomInfo.players[winUser].coins;
	return {changes: changes, remains: remains};
};

// 炸弹金币扣除
pro._getBombCoins = function (wChairID, nums) {
	let changes = [];
	let remains = [];
	for (const key in this.roomInfo.players) {
		if (this.roomInfo.players.hasOwnProperty(key)) {
			let user = this.roomInfo.players[key];
			if (user.chairID == wChairID) {
				this.roomInfo.players[key].coins = user.coins + 2 * nums;
				changes.push(2 * nums);
			} else {
				let remainNums = user.coins - nums
				this.roomInfo.players[key].coins = (remainNums > 0) ? remainNums : 0;
				changes.push(-nums);
			}
			remains.push(this.roomInfo.players[key].coins);
		}
	}
	return {changes: changes, remains: remains};
};

// 要不起自动下手
pro._checkNextOutCard = function (wChairID, nextChariID) {
	if (wChairID == nextChariID) {
		setTimeout(function () {
			// 闹钟提示
			this._broadcastOutCardNotify(this.roomInfo.cardInfo.currentUser);
			this._startAutoSchedule();

			// 最后一手自动出牌
			let handCardData = this.roomInfo.cardInfo.handCardData[wChairID];
			let turnCardData = [];
			let bNextWarn = false;
			let outCard = pdkAIHelper.AISearchOutCard(handCardData, turnCardData, bNextWarn);
			if (outCard && outCard.bCardCount == handCardData.length) {
				this.playCard();
			}

		}.bind(this), 1.5 * 1000);
		return;
	}

	let cardInfo = this.roomInfo.cardInfo;
	let playerCount = 3;
	let handCardData = cardInfo.handCardData[nextChariID];
	let cardCount = cardInfo.cardCount[nextChariID];
	let turnCardData = cardInfo.turnCardData;
	let turnCardCount = cardInfo.turnCardCount;
	this._stopAutoSchedul();

	if (pdkHelper.SearchOutCard(handCardData, cardCount, turnCardData, turnCardCount)==false)
	{
		// 要不起
		setTimeout(function () {
			let wPassUser = nextChariID;
			let currentUser=(wPassUser+1) % playerCount;
			this.roomInfo.cardInfo.currentUser = currentUser;
			this.logger.info('要不起:[%d](%s)',wPassUser, this.roomInfo.players[wPassUser].name);

			// 推送要不起消息
			this._broadcastPassCardMsg(wPassUser, currentUser);

			// 递归
			this._checkNextOutCard(wChairID, currentUser);
		}.bind(this), 1.5 * 1000);

	} else {
		// 闹钟提示
		setTimeout(function () {
			// 闹钟提示
			this._broadcastOutCardNotify(this.roomInfo.cardInfo.currentUser);
			this._startAutoSchedule();

			// 最后一手自动出牌
			let currentUser = this.roomInfo.cardInfo.currentUser;
			let handCardData = this.roomInfo.cardInfo.handCardData[currentUser];
			let turnCardData = this.roomInfo.cardInfo.turnCardData;
			let bNextWarn = this.roomInfo.cardInfo.bUserWarn[(currentUser+1)%playerCount];
			let outCard = pdkAIHelper.AISearchOutCard(handCardData, turnCardData, bNextWarn);
			if (outCard && outCard.bCardCount == handCardData.length) {
				this.playCard();
			}
		}.bind(this), 1.5 * 1000);
	}
};

// 推送玩家手牌消息
pro._broadcastHandCardMsg = function (wChairID) {
	let uid = this._getUidByChairID(wChairID);
	let route = 'onHandCardUser';
	let msg = {
		wChairID: wChairID,
		handCardData: this.roomInfo.cardInfo.handCardData[wChairID] || []
	};
	this._notifyMsgToOtherMem(uid, route, msg);
};

// 推送单张报警消息
pro._broadcastSingCardMsg = function (wChairID) {
	let cardInfo = this.roomInfo.cardInfo;
	cardInfo.bUserWarn[wChairID] = true;
	let route = 'onWarnUser';
	let msg = {wWarnUser: wChairID};
	this._notifyMsgToOtherMem(null, route, msg);
};

// 推送出牌消息
pro._broadcastOutCardMsg = function (wChairID, bCardData, bCardCount, currentUser) {
	let route = 'onOutCard'
	let msg = {
		outcardUser: wChairID,
		cardData: bCardData,
		cardCount: bCardCount,
		currentUser: currentUser
	}
	this._notifyMsgToOtherMem(null, route, msg);
};

// 推送结算消息
pro._broadcastSettlementMsg = function (wChairID, accountData) {
	let route = 'onSettlement'
	let msg = {
		winUser: wChairID,
		accountData: accountData,
		handCardData: this.roomInfo.cardInfo.handCardData,
	}
	this._notifyMsgToOtherMem(null, route, msg);
};

// 广播金币变化
pro._broadcastRefreshCoins = function (remains, changes) {
	// 修改数据库金币数
	for (const key in this.roomInfo.players) {
		if (this.roomInfo.players.hasOwnProperty(key)) {
			const user = this.roomInfo.players[key];
			let preServerID = user.preSid;
			let reaminCoins = remains[key];
			pomelo.app.rpc.connector.entryRemote.onUpdateUsrCoins.toServer(preServerID, user.id, reaminCoins, null);
		}
	}

	let route = 'onUpdateGoldCoins'
	let msg = {
		remains: remains,
		changes: changes,
	}
	this._notifyMsgToOtherMem(null, route, msg);
};

// 更新胜率
pro._updateWinOrFailCount = function (winerId) {
	for (const key in this.roomInfo.players) {
		if (this.roomInfo.players.hasOwnProperty(key)) {
			const user = this.roomInfo.players[key];
			let preServerID = user.preSid;
			let isWiner = (user.id == winerId) ? true: false;
			pomelo.app.rpc.connector.entryRemote.onUpdateUsrWinOrFailCount.toServer(preServerID, user.id, isWiner, null);
		}
	}
};

// 推送要不起消息
pro._broadcastPassCardMsg = function (wPassUser, currentUser) {
	let route = 'onPassCard'
	let msg = {
		wPassUser: wPassUser,
		wCurrentUser: currentUser,
	}
	this._notifyMsgToOtherMem(null, route, msg);
};

// 推送托管消息
pro._broadcastAutoCardMsg = function (wAutoUser, bAuto) {
	let route = 'onAutoCard'
	let msg = {
		wAutoUser: wAutoUser,
		bAuto: bAuto
	}
	this._notifyMsgToOtherMem(null, route, msg);
	this._setAutoState(wAutoUser, bAuto);
	if (bAuto == consts.AutoState.AutoYes && wAutoUser == this.roomInfo.cardInfo.currentUser) {
		// 自动出牌
		this.playCard();
	}
};

// 当前出牌闹钟提示
pro._broadcastOutCardNotify = function (currentUser) {
	let route = 'onOutCardNotify'
	let msg = {
		currentUser: currentUser,
	}
	this._notifyMsgToOtherMem(null, route, msg);
};

// uid 为空向队伍里所有人推送, 否则指定uid推送
pro._notifyMsgToOtherMem = function (uid, route, msg) {
	var uids = [];
	for (const key in this.roomInfo.players) {
		if (this.roomInfo.players.hasOwnProperty(key)) {
			const user = this.roomInfo.players[key];
			if (uid) {
				if (user.id == uid) {
					let preServerID = user.preSid;
					uids.push({uid: user.id, sid: preServerID});
					break;
				}
			} else {
				let preServerID = user.preSid;
				uids.push({uid: user.id, sid: preServerID});
			}
		}
	}

    if (uids.length) {
        messageService.pushMessageByUids(uids, route, msg);
    }
};

// 设置托管状态
pro._setAutoState = function (wChairID, state) {
	let players = this.roomInfo.players;
	if (wChairID) {
		players[wChairID].autoState = state;
	} else {
		for (const key in players) {
			if (players.hasOwnProperty(key)) {
				players[key].autoState = state;
			}
		}
	}
};

// 得到托管状态
pro._getAutoState = function (wChairID) {
	return this.roomInfo.players[wChairID].autoState;
}

// 托管定时器
pro._startAutoSchedule = function (dt, offset) {
	let wChairID = this.roomInfo.cardInfo.currentUser;
	if (wChairID == consts.InvalUser) {
		return;
	}

	let self = this;
	dt = dt || 15;  // 默认15s自动托管
	offset = offset || 1.5; // 默认前端表现延时
	dt = dt + offset;
	
	// 已经托管
	let autoStatus = self._getAutoState(wChairID);
	if (autoStatus == consts.AutoState.AutoYes) {
		dt = offset;
	}

	this._stopAutoSchedul();
	self.autoSchedule = setTimeout(function () {
		if (autoStatus == consts.AutoState.AutoYes) {
			// 自动打牌
			self.playCard();
		} else {
			// 进入托管
			self._broadcastAutoCardMsg(wChairID, consts.AutoState.AutoYes);
		}
	}, dt * 1000);
};

// 定时器停止
pro._stopAutoSchedul = function () {
	if (this.autoSchedule) {
		clearTimeout(this.autoSchedule);
		this.autoSchedule = null;
	}
};

// 托管请求
pro.autoCard = function (uid, bAuto, next) {
	if (this.roomInfo.status !== consts.TableStatus.START) {
		next(null, {code: consts.FAIL});
		return;
	}

	let wChairID = this._getChairIDByUid(uid);
	this._broadcastAutoCardMsg(wChairID, bAuto);
	next(null, consts.OK);
};

pro.leaveRoom = function (uid, next) {
	// 房间不存在
	if (this.isDestroyed()) {
		next(null, {code: consts.LeaveRoomCode.NO_EXIST_ROOM});
		return;
	}

	// 已经开局不能退出
	if (this.roomInfo.status === consts.TableStatus.START) {
		next(null, {code: consts.LeaveRoomCode.START_GAME_NO_LEAVE});
		return;
	}
	next(null, {code: consts.LeaveRoomCode.OK});

	// 玩家退出直接解散房间、机器人退出就退出自己
	let wChairID = this._getChairIDByUid(uid);
	let user = this.roomInfo.players[wChairID];
	let self = this;
	if (common.isRobot(user.openid)) {
		// 离开房间
		let preServerID = user.preSid;
		pomelo.app.rpc.connector.entryRemote.onLeaveGoldGame.toServer(preServerID, user.id, function (resp) {
			// 向其它人广播离开消息
			let route = 'onLeaveRoom';
			let msg = {wChairID: wChairID};
			self._notifyMsgToOtherMem(null, route, msg);
			self.removeUserInPlayers(uid);

			setTimeout(function () {
				let gameType = self.roomInfo.gameType;
				let stage = self.roomInfo.stage;
				let goldRoomId = self.roomInfo.roomid;
				pomelo.app.rpc.matchGlobal.matchRemote.leaveGoldRoom(null, gameType, stage, goldRoomId, uid, null);
			}, 2000);
		});

	} else {
		// 解散房间
		this.destroy();
	}
};

// 销毁
pro.destroy = function () {
	let gameType = this.roomInfo.gameType;
	let stage = this.roomInfo.stage;
	let goldRoomId = this.roomInfo.roomid;
	pomelo.app.rpc.matchGlobal.matchRemote.dissolveGoldRoom(null, gameType, stage, goldRoomId, null);
	let players = this.roomInfo.players;
	for (const key in players) {
		if (players.hasOwnProperty(key)) {
			const user = players[key];
			let preServerID = user.preSid;
			pomelo.app.rpc.connector.entryRemote.onLeaveGoldGame.toServer(preServerID, user.id, null);
		}
	}

	for (const key in players) {
		if (players.hasOwnProperty(key)) {
			const user = players[key];
			let sid = user.preSid;
			let route = 'onLeaveRoom';
			let msg = {wChairID: key}
			let uids = [{
				uid: user.id,
				sid: sid
			}]
			messageService.pushMessageByUids(uids, route, msg);
		}
	}

	Entity.prototype.destroy.call(this);
};