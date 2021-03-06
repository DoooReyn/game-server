/**
 * Date: 2019/2/20
 * Author: admin
 * Description: 管理所有游戏金币场游戏信息, 限定只开一台
 */

module.exports = function (app) {
	return new Remote(app);
};

var Remote = function (app) {
	this.app = app;
};

var pro = Remote.prototype;

pro.getMatchInfo = function (gameType, cb) {
	this.app.get('matchStub').getMatchInfo(gameType, cb);
};

pro.enterGoldRoom = function (gameType, stage, usrInfo, cb) {
	this.app.get('matchStub').enterGoldRoom(gameType, stage, usrInfo, cb);
};

pro.joinGoldRoom = function (goldRoomId, userInfo, cb) {
	this.app.get('matchStub').joinGoldRoom(goldRoomId, userInfo, cb);
};

pro.dissolveGoldRoom = function (gameType, stage, goldRoomId, cb) {
	this.app.get('matchStub').dissolveGoldRoom(gameType, stage, goldRoomId, cb);
};

pro.leaveGoldRoom = function (gameType, stage, goldRoomId, uid, cb) {
	this.app.get('matchStub').leaveGoldRoom(gameType, stage, goldRoomId, uid, cb);
};