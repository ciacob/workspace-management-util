import shell from "shelljs";
import path from "path";


/**
 * Detects workspaces containing ActionScript or Flex AIR projects.
 * @param   {string[]}
 *          searchPaths - Array of paths to search within.
 *
 * @param   {string[]} searchFileExtensions
 *          Array of file extensions to search for.
 *
 * @param   {string} sourceFolderName
 *          Name of the source folder.
 *
 * @param   {string[]} [blackList]
 *          Array of paths to be excluded from the search results. Optional.
 * 
 * @returns {object[]}
 *          Array ob objects, each in the format of 
 *          {
 *              rootPath: '',
 *              lastTouched : { msecs: 0, timestamp: 'YYYY/MM/DD hh:mm:ss'},
 *              projectPaths : []
 *          }
 */
function detectWorkspaces(
    searchPaths,
    searchFileExtensions = null,
    sourceFolderName = null,
    blackList = []
) {

    // Check for all mandatory arguments
    if (!searchPaths || !searchPaths.length || !searchFileExtensions || 
        !searchFileExtensions.length || !sourceFolderName) {
        return [];
    }

    // If given, ensure blacklist paths will work on Windows as well.
    const isWindows = (process.platform === "win32");
    if (blackList && blackList.length && isWindows) {
        blackList = blackList.map((blackListEntry) =>
          path.normalize(blackListEntry).toUpperCase()
        );
    }

    const tmpWorkspaces = [];

    // We search all given search paths using native techniques, in hope
    // for faster response.
    for (const searchPath of searchPaths) {
        const extensionPattern = searchFileExtensions.map((ext) => `*.${ext}`).join(" ");
        let rawPaths = "";

        // On windows we need to `be` in the folder we search in when using `where.exe`.
        // Extra case is needed when switching to the root of a drive. We navigate back
        // when done.
        if (isWindows) {
            const driveLetter = path.parse(searchPath).root;

            const searchingFromRoot = searchPath.toUpperCase() === driveLetter.toUpperCase();

            if (searchingFromRoot) {
                shell.cd(`${driveLetter}\\`);
            } else {
                shell.cd (searchPath);
            }
            const command = `where /R ${searchPath} ${extensionPattern}`;
            rawPaths = shell.exec(command, { silent: true }).stdout;
            shell.cd("-");
        } else {
            const command = `find ${searchPath} -type f \\( -name "${searchFileExtensions.join(
                '" -o -name "'
            )}" \\)`;
            rawPaths = shell.exec(command, { silent: true }).stdout;
        }

        // Split, trim, sort and filter the resulting paths to prepare them for further processing.
        // More exactly, we want to remove those paths that are blacklisted, or not exhibiting the
        //
        // <sourceFolderName>/file.<searchFileExtension>
        //
        // topology, i.e., we want our searched-for files to live directly underneath the expected
        // source folder.
        if (rawPaths) {
            const filePaths = rawPaths
                .trim()
                .split("\n")
                .map((filePath) => path.normalize(filePath.trim()))
                .filter(filePath => {
                    const isBlacklisted = blackList.some((blackListedPath) => (isWindows?
                        filePath.toUpperCase() : filePath).startsWith(blackListedPath));
                    const deepestDir = path.dirname(filePath);
                    const deepestDirName = path.basename(deepestDir);
                    const notInSrcFolder = isWindows?
                        deepestDirName.toUpperCase() !== sourceFolderName.toUpperCase():
                        deepestDirName != sourceFolderName;
                    return (!isBlacklisted && !notInSrcFolder);
                })
                .sort();

            // Loop through the remaining `filePaths` and try to infer the list of workspaces
            // they imply.
            const projectRoots = [];
            filePaths.forEach((filePath) => {
                const projectRoot = path.dirname(path.dirname (filePath));
                if (!projectRoots.includes (projectRoot)) {
                    projectRoots.push (projectRoot);
                }
                const likelyWorkspaceRoot = path.dirname(projectRoot);

                // Case 1. The `likelyWorkspaceRoot` is a shorter version of an already known
                // workspace root: we trim that one to this shorter version.
                let rootObject = tmpWorkspaces.find (tmpWorkspace => 
                    tmpWorkspace.rootPath.includes(likelyWorkspaceRoot) &&
                    tmpWorkspace.rootPath !== likelyWorkspaceRoot);
                if (rootObject) {
                    rootObject.rootPath = likelyWorkspaceRoot;
                } else {

                    // Case 2. The `likelyWorkspaceRoot` is a longer or of-equal-length version
                    // of an already known workspace root: nothing to do.
                    rootObject = tmpWorkspaces.find (tmpWorkspace => 
                        likelyWorkspaceRoot.includes(tmpWorkspace.rootPath));

                    // Case 3. This `likelyWorkspaceRoot` was never known before: we register it.
                    if (!rootObject) {
                        rootObject = {
                            rootPath: likelyWorkspaceRoot,
                            lastTouched : { msecs: 0, timestamp: ''},
                            projectPaths : []
                        }
                        tmpWorkspaces.push (rootObject);
                    }
                }
            });

            // Place the collected project root paths inside their corresponding workspace. We first sort
            // the collected workspaces to put the longer first, to minimize chances of mismatch.
            tmpWorkspaces.sort ((a, b) => a.rootPath.localeCompare(b.rootPath));
            projectRoots.forEach(projectRoot => {
                const parentWorkspace = tmpWorkspaces.find(tmpWorkspace => 
                    projectRoot.startsWith(tmpWorkspace.rootPath));
                parentWorkspace.projectPaths.push (projectRoot);
            });
        }
    }
    return tmpWorkspaces;
}

export { detectWorkspaces };