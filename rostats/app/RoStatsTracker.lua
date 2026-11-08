--[[
	RoStats Tracker — à placer dans un Script de ServerScriptService
	------------------------------------------------------------------
	Tourne sur les serveurs Roblox : tout est enregistré même quand ton PC
	et l'appli RoStats sont éteints. RoStats récupère l'historique à l'ouverture.

	Enregistre chaque jour (UTC) dans le DataStore "RoStats_v1" :
	  • Robux dépensés (Game Pass + Developer Products) et nombre de ventes
	  • Détail par article (nom, ventes, Robux)
	  • Entrées de joueurs, sessions, temps de jeu total, pic par serveur
	  • Courbe des joueurs connectés (un point toutes les 5 minutes)
	L'appli RoStats lit ces données via Open Cloud (clé API en lecture seule).

	Game Pass : suivis automatiquement.

	Developer Products : deux options
	  A) Automatique : AUTO_DEV_PRODUCTS = true
	  B) Précis (recommandé si ton jeu a un ProcessReceipt) : AUTO_DEV_PRODUCTS = false,
	     puis dans TON ProcessReceipt, juste avant "return Enum.ProductPurchaseDecision.PurchaseGranted" :
	         if shared.RoStatsRecordReceipt then shared.RoStatsRecordReceipt(receipt) end

	Les tests dans Studio ne sont pas comptés (RECORD_IN_STUDIO = false).
]]

local AUTO_DEV_PRODUCTS = true
local RECORD_IN_STUDIO = false
local STORE_NAME = "RoStats_v1"
local FLUSH_EVERY = 10 -- secondes (ventes visibles dans RoStats ~10 s après l'achat)
local CCU_BUCKET = 300 -- secondes entre deux points de la courbe des joueurs

local DataStoreService = game:GetService("DataStoreService")
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local ENABLED = RECORD_IN_STUDIO or not RunService:IsStudio()
local store = DataStoreService:GetDataStore(STORE_NAME)

local function emptyBuffer()
	return { robux = 0, sales = 0, joins = 0, sessions = 0, playSeconds = 0, peak = 0, items = {}, ccu = {} }
end

local pending = emptyBuffer()
local joinTimes = {}
local infoCache = {}

local function dayOf(t)
	return os.date("!%Y-%m-%d", t)
end

local function getInfo(id, infoType)
	local key = tostring(infoType) .. ":" .. tostring(id)
	if infoCache[key] then
		return infoCache[key]
	end
	local ok, info = pcall(function()
		return MarketplaceService:GetProductInfoAsync(id, infoType)
	end)
	local result = { name = "#" .. tostring(id), price = 0 }
	if ok and info then
		result = { name = info.Name or result.name, price = info.PriceInRobux or 0 }
		infoCache[key] = result
	end
	return result
end

local function record(kind, id, price, name)
	price = tonumber(price) or 0
	pending.robux += price
	pending.sales += 1
	local key = kind .. "_" .. tostring(id)
	local item = pending.items[key] or { n = name, c = 0, r = 0 }
	item.c += 1
	item.r += price
	item.n = name
	pending.items[key] = item
end

-- Game Pass
MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, purchased)
	if purchased then
		local info = getInfo(passId, Enum.InfoType.GamePass)
		record("GP", passId, info.price, info.name)
	end
end)

-- Developer Products (option A)
if AUTO_DEV_PRODUCTS then
	MarketplaceService.PromptProductPurchaseFinished:Connect(function(userId, productId, purchased)
		if purchased then
			local info = getInfo(productId, Enum.InfoType.Product)
			record("DP", productId, info.price, info.name)
		end
	end)
end

-- Developer Products (option B)
shared.RoStatsRecordReceipt = function(receiptInfo)
	if AUTO_DEV_PRODUCTS or not receiptInfo then
		return
	end
	local info = getInfo(receiptInfo.ProductId, Enum.InfoType.Product)
	record("DP", receiptInfo.ProductId, receiptInfo.CurrencySpent or info.price, info.name)
end

-- Joueurs et sessions
local function onJoin(player)
	pending.joins += 1
	joinTimes[player] = os.clock()
	pending.peak = math.max(pending.peak, #Players:GetPlayers())
end

local function onLeave(player)
	local t = joinTimes[player]
	if t then
		pending.sessions += 1
		pending.playSeconds += os.clock() - t
		joinTimes[player] = nil
	end
end

Players.PlayerAdded:Connect(onJoin)
Players.PlayerRemoving:Connect(onLeave)
for _, p in Players:GetPlayers() do
	onJoin(p)
end

-- Courbe des joueurs : chaque serveur ajoute ses joueurs au créneau de 5 min en cours,
-- la somme de tous les serveurs donne le nombre total de joueurs connectés.
local lastBucket = nil
local function sampleCcu()
	local now = os.time()
	local bucket = math.floor(now / CCU_BUCKET)
	if bucket == lastBucket then
		return
	end
	lastBucket = bucket
	local n = #Players:GetPlayers()
	if n <= 0 then
		return
	end
	local day = dayOf(bucket * CCU_BUCKET)
	local idx = tostring(math.floor((bucket * CCU_BUCKET % 86400) / CCU_BUCKET))
	pending.ccu[day] = pending.ccu[day] or {}
	pending.ccu[day][idx] = (pending.ccu[day][idx] or 0) + n
end

-- Écriture dans le DataStore
local function isEmpty(b)
	return b.robux == 0 and b.sales == 0 and b.joins == 0 and b.sessions == 0 and b.peak == 0 and next(b.ccu) == nil
end

local function mergeBack(b, today)
	if today then
		pending.robux += b.robux
		pending.sales += b.sales
		pending.joins += b.joins
		pending.sessions += b.sessions
		pending.playSeconds += b.playSeconds
		pending.peak = math.max(pending.peak, b.peak)
		for k, it in b.items do
			local cur = pending.items[k] or { n = it.n, c = 0, r = 0 }
			cur.c += it.c
			cur.r += it.r
			pending.items[k] = cur
		end
	end
	for day, points in b.ccu do
		pending.ccu[day] = pending.ccu[day] or {}
		for idx, n in points do
			pending.ccu[day][idx] = (pending.ccu[day][idx] or 0) + n
		end
	end
end

local function writeDay(day, batch, withCounters)
	return pcall(function()
		store:UpdateAsync("day_" .. day, function(old)
			old = old or {}
			if withCounters then
				old.robux = (old.robux or 0) + batch.robux
				old.sales = (old.sales or 0) + batch.sales
				old.joins = (old.joins or 0) + batch.joins
				old.sessions = (old.sessions or 0) + batch.sessions
				old.playSeconds = math.floor((old.playSeconds or 0) + batch.playSeconds)
				old.peak = math.max(old.peak or 0, batch.peak)
				old.items = old.items or {}
				for k, it in batch.items do
					local cur = old.items[k] or { n = it.n, c = 0, r = 0 }
					cur.n = it.n
					cur.c += it.c
					cur.r += it.r
					old.items[k] = cur
				end
			end
			local points = batch.ccu[day]
			if points then
				old.ccu = old.ccu or {}
				for idx, n in points do
					old.ccu[idx] = (old.ccu[idx] or 0) + n
				end
			end
			old.updated = os.time()
			return old
		end)
	end)
end

local flushing = false
local function flush()
	if not ENABLED or flushing or isEmpty(pending) then
		return
	end
	flushing = true
	local batch = pending
	pending = emptyBuffer()
	local today = dayOf(os.time())

	local ok, err = writeDay(today, batch, true)
	if not ok then
		warn("[RoStats] Échec d'écriture, nouvel essai plus tard :", err)
		mergeBack(batch, true)
	else
		-- créneaux de la veille (passage de minuit)
		for day in batch.ccu do
			if day ~= today then
				local ok2 = writeDay(day, batch, false)
				if not ok2 then
					mergeBack({ ccu = { [day] = batch.ccu[day] } }, false)
				end
			end
		end
	end
	pending.peak = math.max(pending.peak, #Players:GetPlayers())
	flushing = false
end

task.spawn(function()
	while true do
		sampleCcu()
		flush()
		task.wait(FLUSH_EVERY)
	end
end)

game:BindToClose(function()
	for _, p in Players:GetPlayers() do
		onLeave(p)
	end
	flush()
end)

print(ENABLED and "[RoStats] Tracker actif" or "[RoStats] Tracker en pause dans Studio (les tests ne sont pas comptés)")
