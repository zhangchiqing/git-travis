#!/usr/bin/env node

/*
Copyright (c) 2012, Yahoo! Inc. All rights reserved.
Code licensed under the BSD License:
http://yuilibrary.com/license/
*/

/*jshint maxlen: 300 */

var which = require('which'),
    spawn = require('child_process').spawn,
    exec = require('child_process').exec,
    chalk = require('chalk'),
    https = require('https'),
    prompt = require('prompt'),
    Travis = require('travis-ci'),
    travis,
    good = chalk.green("✔"),
    bad = chalk.red("✖"),
    progress = chalk.yellow("♢");

if (process.platform === 'win32') {
    good = chalk.green('OK');
    bad = chalk.red('X');
    progress = chalk.yellow('O');
}

exports.good = good;
exports.bad = bad;

var getInfo = function(callback) {
    which('git', function(err, git) {
        if (err) {
            console.error(err);
            process.exit(1);
        }
        var child = spawn(git, ['remote', '-v']),
            user, repo;
        child.stdout.on('data', function(data) {
            data = data.toString().split('\n');
            data.forEach(function(line) {
                if (line.indexOf('origin') === 0 && !user && !repo) {
                    line = line.replace(' (fetch)', '').replace(' (push)', '');
                    var origin = line.split('\t')[1];
                    if (origin.indexOf('git@') === 0) {
                        //private repo
                        origin = origin.replace('git@github.com:', '').replace('.git', '').split('/');
                    } else if (origin.indexOf('git://') === 0) {
                        origin = origin.replace('git://github.com/', '').replace('.git', '').split('/');
                    } else if (origin.indexOf('https://') === 0) {
                        origin = origin.replace('https://github.com/', '').replace('.git', '').split('/');
                    }
                    if (origin && origin.length) {
                        user = origin[0].trim();
                        repo = origin[1].trim();
                        if (!user || !repo) {
                            throw('failed to parse git remote');
                        }
                        exec(git + ' status', {
                            cwd: process.cwd()
                        }, function(err, stdout) {
                            var branch = stdout.trim().split('\n')[0];
                            branch = branch.replace('# On branch ', '').replace('On branch ', '') || 'master';
                            callback(user, repo, branch);
                        });
                    }
                }
            });
        });
    });
};

exports.info = getInfo;

var fetch = function(user, repo, branch, callback) {
    travis.repos.builds({
        owner_name: user,
        name: repo
    }, function (err, res) {
        if (err) {
            return callback(err);
        }
        var build = res.builds || res,
            item, other, commit, msg = null;

        if (build && !build.hasOwnProperty('length')) {
            callback('failed to fetch info for ' +user + '/' + repo);
            return;
        }

        if (Array.isArray(res)) {
            res.some(function(i) {
                var ret = (i.branch === branch);
                if (ret) {
                    item = i;
                }
                return ret;
            });
            other = res[0];
        } else {
            res.commits.some(function(i) {
                var ret = (i.branch === branch);
                if (ret) {
                    commit = i;
                }
                return ret;
            });

            res.builds.some(function(i) {
                var ret = (i.commit_id === commit.id);
                if (ret) {
                    item = i;
                }
                return ret;
            });

            other = res.builds[0];
            commit = res.commits[0];
        }

        if (!item) {
            msg = 'no recent builds on ' + branch + ' showing latest';
            item = other;
        }

        if (!item) {
            return callback('no item found');
        }

        callback(null, {
            msg: msg,
            item: item,
            commit: commit
        });
    });

};

exports.fetch = fetch;

var isPublicRepository = function (user, repo, callback) {
    https.request({
        method: 'HEAD',
        host: 'api.github.com',
        path: '/repos/' + user + '/' + repo,
        headers: {
            'user-agent': 'git-travis cli tool'
        }
    }, function (res) {
        //Empty Data listener
        res.on('data', function() { });
        if (res.statusCode === 200) {
            return callback(null, true);
        } else if (res.statusCode === 404) {
            return callback(null, false);
        } else {
            return callback('unknown');
        }
    }).end();
};

exports.print = function(user, repo, branch, callback) {
    console.log('Fetching build status for', user + '/' + repo + ':' + branch);

    var onFetch = function(err, data) {
        var status, commit, item;

        if (err) {
            if (callback) {
                return callback(err);
            } else {
                throw err;
            }
        }

        if (data.msg) {
            console.log('  ', data.msg);
        }

        commit = data.commit;
        item = data.item;

        status = (item.result ? bad : good);

        if (item.status === null) {
            status = progress;
        }

        console.log('   ', status, user + '/' + repo);
        travis.repos.builds({
            owner_name: user,
            name: repo,
            id: item.id
        }, function(err, res) {
            if (err) {
                console.log('   ', bad, 'failed to fetch info for', user + '/' + repo);
                if (callback) {
                    callback();
                }
                return;
            }
            var json = res,
                message = json.message || json.commit.message,
                sha = json.commit.sha || json.commit,
                url = json.commit.compare_url || json.compare_url,
                branch = json.branch || json.commit.branch,
                name = json.author_name || json.commit.author_name,
                email = json.author_email || json.commit.author_email,
                state = json.state || json.build.state,
                jobs = json.matrix || json.jobs;

            message = message.split('\n')[0];
            sha = sha.substring(0, 7);

            console.log('       ', 'Compare: ', url);
            console.log('       ', ((state === 'failed') ? bad : ((state === 'passed') ? good: progress)), sha, '(' + branch + ')',
                message, '(' + name + ' <' + email + '>)', chalk.white('(' + state + ')'));

            jobs.forEach(function(m) {
                var lang = m.config.language;
                console.log('           ', ((m.state === 'failed') ? bad : ((m.finished_at === null) ? progress : good)),
                    m.number, lang, m.config[lang], chalk.white('(' + m.state + ')'));
            });
            if (callback) {
                callback();
            }
        });
    };

    var travisAuthWithUsernamePassword = function (callback) {
        prompt.start();
        prompt.get({
            properties: {
                username: {
                    required: true
                },
                password: {
                    required: true,
                    hidden: true
                }
            }
        }, function (err, result) {
            if (err) {
                return callback(err);
            }

            var auth = {
                username: result.username,
                password: result.password
            };
            callback(null, auth);
        });
    };

    var getGHToken = function () {
        return process.env.GITHUB_ACCESS_TOKEN;
    };

    var hasToken = !!getGHToken();

    // https://www.npmjs.com/package/travis-ci#authentication
    var travisAuthWithToken = function (callback) {
        var auth = {
            github_token: getGHToken()
        };
        callback(null, auth);
    };

    isPublicRepository(user, repo, function (err, repositoryIsPublic) {
        if (err) {
            return callback(err);
        }

        travis = new Travis({
            version: '2.0.0',
            pro: !repositoryIsPublic
        });

        if (repositoryIsPublic) {
            fetch(user, repo, branch, onFetch);
        } else {
            var travisAuthMethod = hasToken ?
                travisAuthWithToken :
                travisAuthWithUsernamePassword;

            travisAuthMethod(function (err, authMethod) {
                if (err) {
                    return callback(err);
                }

                travis.authenticate(authMethod, function (err) {
                    if (err) {
                        return callback(err);
                    }

                    console.log();
                    fetch(user, repo, branch, onFetch);
                });
            });
        }
    });
};

