"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var bullmq_1 = require("bullmq");
var ioredis_1 = require("ioredis");
// @ts-ignore
var prisma_1 = require("./shared/lib/prisma");
var child_process_1 = require("child_process");
var fs_1 = require("fs");
var fs = require("fs/promises");
var path = require("path");
var node_fetch_1 = require("node-fetch");
// Configuration
var REDIS_HOST = process.env.REDIS_HOST || 'localhost';
var REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
var redisConnection = new ioredis_1.default({
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: null,
});
// Queues for scoring
var provocativenessQueue = new bullmq_1.Queue('score-provocativeness', { connection: redisConnection });
var comedicQueue = new bullmq_1.Queue('score-comedic', { connection: redisConnection });
var provocativenessEvents = new bullmq_1.QueueEvents('score-provocativeness', { connection: redisConnection });
var comedicEvents = new bullmq_1.QueueEvents('score-comedic', { connection: redisConnection });
// Helper: Download video
function downloadVideo(url, dest) {
    return __awaiter(this, void 0, void 0, function () {
        var res, stream;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, node_fetch_1.default)(url)];
                case 1:
                    res = _a.sent();
                    if (!res.ok || !res.body)
                        throw new Error("Failed to download video: ".concat(res.statusText));
                    stream = (0, fs_1.createWriteStream)(dest);
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            res.body.pipe(stream);
                            res.body.on('error', function (e) { return reject(e); });
                            stream.on('finish', function () { return resolve(); });
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// Helper: Transcribe
function transcribeVideo(videoPath) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var python = (0, child_process_1.spawn)('python3', ['scripts/transcribe.py', videoPath]);
                    var output = '';
                    var error = '';
                    python.stdout.on('data', function (d) { return output += d.toString(); });
                    python.stderr.on('data', function (d) { return error += d.toString(); });
                    python.on('close', function (code) {
                        if (code !== 0)
                            return reject(new Error("Transcription failed: ".concat(error)));
                        try {
                            var parsed = JSON.parse(output);
                            resolve(parsed.segments);
                        }
                        catch (e) {
                            reject(new Error("Invalid JSON: ".concat(e)));
                        }
                    });
                })];
        });
    });
}
// Helper: Generate Clip (FFmpeg)
function createClip(videoPath, start, end, text, outPath, aspectRatio) {
    return __awaiter(this, void 0, void 0, function () {
        var srtPath, sTime, duration, dDate, srt, aspectRatioFilter;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    srtPath = outPath.replace('.mp4', '.srt');
                    sTime = "00:00:00,000";
                    duration = end - start;
                    dDate = new Date(duration * 1000).toISOString().substring(11, 23).replace('.', ',');
                    srt = "1\n".concat(sTime, " --> ").concat(dDate, "\n").concat(text, "\n");
                    return [4 /*yield*/, fs.writeFile(srtPath, srt)];
                case 1:
                    _a.sent();
                    aspectRatioFilter = (function () {
                        switch (aspectRatio) {
                            case '16:9': return 'scale=1280:720,setsar=1';
                            case '1:1': return 'scale=720:720,setsar=1';
                            case '9:16':
                            default: return 'scale=720:1280,setsar=1';
                        }
                    })();
                    return [2 /*return*/, new Promise(function (resolve, reject) {
                            var ffmpeg = (0, child_process_1.spawn)('ffmpeg', [
                                '-y',
                                '-i', videoPath,
                                '-ss',
                                "".concat(start),
                                '-to',
                                "".concat(end),
                                '-vf',
                                "".concat(aspectRatioFilter, ",subtitles=").concat(srtPath.replace(/:/g, '\\:')),
                                '-c:v', 'libx264',
                                '-c:a', 'aac',
                                outPath,
                            ]);
                            ffmpeg.on('close', function (code) {
                                if (code === 0)
                                    resolve();
                                else
                                    reject(new Error("FFmpeg failed (".concat(code, ")")));
                            });
                        })];
            }
        });
    });
}
// Main Worker
new bullmq_1.Worker('clip-generation', function (job) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, feedVideoId, userId, aspectRatio, feedVideo, tempDir, videoPath, segments, windows, i, group, text, start, end, scoredWindows, topProvocative, topComedic, selected, clips, _i, selected_1, w, outPath, err_1;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = job.data, feedVideoId = _a.feedVideoId, userId = _a.userId, aspectRatio = _a.aspectRatio;
                console.log("\uD83D\uDCE5 Processing clip-generation for ".concat(feedVideoId));
                _b.label = 1;
            case 1:
                _b.trys.push([1, 14, , 15]);
                return [4 /*yield*/, prisma_1.prisma.feedVideo.findUnique({ where: { id: feedVideoId } })];
            case 2:
                feedVideo = _b.sent();
                if (!feedVideo || !feedVideo.s3Url)
                    throw new Error('Video not found or missing S3 URL');
                tempDir = "/tmp/".concat(feedVideoId);
                return [4 /*yield*/, fs.mkdir(tempDir, { recursive: true })];
            case 3:
                _b.sent();
                videoPath = path.join(tempDir, 'source.mp4');
                // 2. Download
                console.log('⬇️ Downloading video...');
                return [4 /*yield*/, downloadVideo(feedVideo.s3Url, videoPath)];
            case 4:
                _b.sent();
                // 3. Transcribe
                console.log('🎤 Transcribing...');
                return [4 /*yield*/, transcribeVideo(videoPath)];
            case 5:
                segments = _b.sent();
                // Save transcript to DB
                return [4 /*yield*/, prisma_1.prisma.feedVideo.update({
                        where: { id: feedVideoId },
                        data: {
                            transcript: segments.map(function (s) { return s.text; }).join(' '),
                            transcriptJson: segments,
                        }
                    })];
            case 6:
                // Save transcript to DB
                _b.sent();
                windows = [];
                for (i = 0; i < segments.length; i += 3) {
                    group = segments.slice(i, i + 3);
                    text = group.map(function (s) { return s.text; }).join(' ');
                    start = group[0].start;
                    end = group[group.length - 1].end;
                    windows.push({ start: start, end: end, text: text, index: i });
                }
                console.log("\uD83E\uDDE0 Scoring ".concat(windows.length, " windows..."));
                return [4 /*yield*/, Promise.all(windows.map(function (w) { return __awaiter(void 0, void 0, void 0, function () {
                        var pJob, cJob, _a, pResult, cResult;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0: return [4 /*yield*/, provocativenessQueue.add('score', { transcript: w.text })];
                                case 1:
                                    pJob = _b.sent();
                                    return [4 /*yield*/, comedicQueue.add('score', { transcript: w.text })];
                                case 2:
                                    cJob = _b.sent();
                                    return [4 /*yield*/, Promise.all([
                                            pJob.waitUntilFinished(provocativenessEvents),
                                            cJob.waitUntilFinished(comedicEvents)
                                        ])];
                                case 3:
                                    _a = _b.sent(), pResult = _a[0], cResult = _a[1];
                                    return [2 /*return*/, __assign(__assign({}, w), { provocativeness: pResult.score, comedic: cResult.score, pReasoning: pResult.reasoning, cReasoning: cResult.reasoning })];
                            }
                        });
                    }); }))];
            case 7:
                scoredWindows = _b.sent();
                topProvocative = __spreadArray([], scoredWindows, true).sort(function (a, b) { return b.provocativeness - a.provocativeness; }).slice(0, 2);
                topComedic = __spreadArray([], scoredWindows, true).sort(function (a, b) { return b.comedic - a.comedic; }).slice(0, 2);
                selected = new Set(__spreadArray(__spreadArray([], topProvocative, true), topComedic, true));
                console.log("\u2702\uFE0F Generating ".concat(selected.size, " clips..."));
                clips = [];
                _i = 0, selected_1 = selected;
                _b.label = 8;
            case 8:
                if (!(_i < selected_1.length)) return [3 /*break*/, 12];
                w = selected_1[_i];
                outPath = path.join(tempDir, "clip-".concat(w.index, ".mp4"));
                return [4 /*yield*/, createClip(videoPath, w.start, w.end, w.text, outPath, aspectRatio || '9:16')];
            case 9:
                _b.sent();
                console.log("\u2705 Generated clip: ".concat(outPath, " (P: ").concat(w.provocativeness, ", C: ").concat(w.comedic, ")"));
                // Create Video entry in DB
                return [4 /*yield*/, prisma_1.prisma.video.create({
                        data: {
                            userId: userId,
                            videoTitle: "Viral Clip ".concat(w.index),
                            s3Url: "file://".concat(outPath), // Placeholder
                            s3Key: "clips/".concat(feedVideoId, "/").concat(w.index),
                            transcript: w.text,
                            approvedForSplicing: false,
                            fileName: "clip-".concat(w.index, ".mp4")
                        }
                    })];
            case 10:
                // Create Video entry in DB
                _b.sent();
                _b.label = 11;
            case 11:
                _i++;
                return [3 /*break*/, 8];
            case 12: 
            // Cleanup
            return [4 /*yield*/, fs.rm(tempDir, { recursive: true, force: true })];
            case 13:
                // Cleanup
                _b.sent();
                console.log('🏁 Job complete');
                return [3 /*break*/, 15];
            case 14:
                err_1 = _b.sent();
                console.error('❌ Job failed:', err_1);
                throw err_1;
            case 15: return [2 /*return*/];
        }
    });
}); }, { connection: redisConnection });
