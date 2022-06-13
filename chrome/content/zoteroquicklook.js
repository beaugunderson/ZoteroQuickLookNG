// This is hopefully not needed in the future.
const INTEGRATION_TYPE_ITEM = 1;

Zotero.ZoteroQuickLook = {
  initialized: false,
  proc: null,
  isBrowseMode: false,
  viewerExecutable: null,
  viewerBaseArguments: null,

  init: async function () {
    if (document.getElementById("zotero-itemmenu") == null) {
      setTimeout(() => this.init(), 1000);
      return;
    }

    document
      .getElementById("zotero-itemmenu")
      .addEventListener("popupshowing", this.showQuickLookMenu, false);

    document
      .getElementById("zotero-items-tree")
      .addEventListener("keydown", this.onKey, false);

    if (!this.initialized) {
      Zotero.debug("ZoteroQuickLook: starts init", 3);

      Zotero.ZoteroQuickLook.initExecutable();

      Zotero.debug("ZoteroQuickLook: finished init", 3);

      this.initialized = true;
    }
  },

  initExecutable: function (scriptLocation) {
    this.viewerExecutable = Zotero.File.pathToFile("/usr/bin/qlmanage");
    this.viewerBaseArguments = ["-p"];
  },

  getPref: function (pref) {
    return Zotero.Prefs.get("extensions.zoteroquicklook." + pref, true);
  },

  cleanFileName: function (filename) {
    return filename;
  },

  closeQuickLook: function () {
    Zotero.debug("ZoteroQuickLook: is killing quicklook viewer.");
    Zotero.ZoteroQuickLook.proc.kill();
    Zotero.ZoteroQuickLook.proc = null;
  },

  // Checks if quicklook is active.
  isActive: function () {
    //On windows checking for the process to be active is not currently supported.
    return (
      Zotero.ZoteroQuickLook.proc !== null &&
      Zotero.ZoteroQuickLook.proc.isRunning
    );
  },

  // Cleans old notes from cahce directory if found.
  cleanOldNotes: function () {
    // Delete the ZoteroQuickLook directory if found
    var file = Components.classes["@mozilla.org/file/directory_service;1"]
      .getService(Components.interfaces.nsIProperties)
      .get("TmpD", Components.interfaces.nsIFile);

    file.append("ZoteroQuickLook");

    if (file.exists()) {
      // if a cache directory exists, remove it
      file.remove(true);
    }
  },

  // Checks the attachment file or writes a content of a note to a file and then pushes this to args.
  pushItemToArgs: async function (args, item) {
    if (item.isAttachment()) {
      if (item.attachmentLinkMode == Zotero.Attachments.LINK_MODE_LINKED_URL) {
        return;
      }

      let isLinkedFile = !item.isImportedAttachment();
      let path = item.getFilePath();

      if (!path) {
        ZoteroPane_Local.showAttachmentNotFoundDialog(item.id, path, {
          noLocate: true,
          notOnServer: true,
          linkedFile: isLinkedFile,
        });
        return;
      }

      let fileExists = await OS.File.exists(path);

      // If the file is an evicted iCloud Drive file, launch that to trigger a download.
      // As of 10.13.6, launching an .icloud file triggers the download and opens the
      // associated program (e.g., Preview) but won't actually open the file, so we wait a bit
      // for the original file to exist and then continue with regular file opening below.
      //
      // To trigger eviction for testing, use Cirrus from https://eclecticlight.co/downloads/
      if (!fileExists && isLinkedFile) {
        // Get the path to the .icloud file
        let iCloudPath = Zotero.File.getEvictedICloudPath(path);

        if (await OS.File.exists(iCloudPath)) {
          // Launching qlmanage should trigger an iCloud download
          Zotero.debug("ZoteroQuickLook: Triggering download of iCloud file");

          await args.push(Zotero.ZoteroQuickLook.cleanFileName(path));

          return;
        }
      }

      if (fileExists) {
        await args.push(Zotero.ZoteroQuickLook.cleanFileName(path));
        return;
      }

      if (
        isLinkedFile ||
        !Zotero.Sync.Storage.Local.getEnabledForLibrary(item.libraryID)
      ) {
        this.showAttachmentNotFoundDialog(itemID, path, {
          noLocate: noLocateOnMissing,
          notOnServer: false,
          linkedFile: isLinkedFile,
        });

        return;
      }

      try {
        await Zotero.Sync.Runner.downloadFile(item);
      } catch (e) {
        // TODO: show error somewhere else
        Zotero.debug(e, 1);
        ZoteroPane_Local.syncAlert(e);
        return;
      }

      if (!(await item.getFilePathAsync())) {
        ZoteroPane_Local.showAttachmentNotFoundDialog(item.id, path, {
          noLocate: noLocateOnMissing,
          notOnServer: true,
        });
        return;
      } else {
        // Try previeviewing file after download
        await args.push(Zotero.ZoteroQuickLook.cleanFileName(path));
      }
    } else if (item.isNote()) {
      // Write the content of the note to a temporary file

      var file = Components.classes["@mozilla.org/file/directory_service;1"]
        .getService(Components.interfaces.nsIProperties)
        .get("TmpD", Components.interfaces.nsIFile);

      file.append("ZoteroQuickLook");

      // If the directory does not exists, create it
      if (!file.exists() || !file.isDirectory()) {
        // if it doesn't exist, create
        file.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0777);
      }
      file.append(item.getNoteTitle() + ".html");
      file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0666);

      //Source https://developer.mozilla.org/en/Code_snippets/File_I%2F%2FO

      // file is nsIFile, data is a string
      var foStream = Components.classes[
        "@mozilla.org/network/file-output-stream;1"
      ].createInstance(Components.interfaces.nsIFileOutputStream);

      // use 0x02 | 0x10 to open file for appending.
      foStream.init(file, 0x02 | 0x08 | 0x20, 0666, 0);
      // write, create, truncate
      // In a c file operation, we have no need to set file mode with or operation,
      // directly using "r" or "w" usually.

      // if you are sure there will never ever be any non-ascii text in data you can
      // also call foStream.writeData directly
      var converter = Components.classes[
        "@mozilla.org/intl/converter-output-stream;1"
      ].createInstance(Components.interfaces.nsIConverterOutputStream);
      converter.init(foStream, "UTF-8", 0, 0);
      converter.writeString(item.getNote());
      converter.close(); // this closes foStream

      args.push(Zotero.ZoteroQuickLook.cleanFileName(file.path));
    }
  },

  // Opens the quick look window with the currently active items.
  openQuickLook: async function (items) {
    Zotero.debug("ZoteroQuickLook: opening viewer", 3);

    var args = this.viewerBaseArguments.slice();

    // A boolean indicating if we have notes this far.
    var notesFound = false;
    var filesFound = false;

    // Combine all filenames into an array
    // Note that for default Windows behavior, only the first time will be displayed

    for (item in items) {
      if (items[item].isAttachment() || items[item].isNote()) {
        if (items[item].isNote() & !notesFound) {
          this.cleanOldNotes();
          notesFound = true;
        }
        await this.pushItemToArgs(args, items[item]);
        filesFound = true;
      }

      // See if it has children and add them. Best attachment comes first.
      // Notes come after attachments
      else {
        var attachments = items[item].getAttachments(false);
        var notes = items[item].getNotes(false);

        if ((notes !== false) & !notesFound) {
          this.cleanOldNotes();
          notesFound = true;
        }

        children = new Array();

        if (attachments != false) {
          children = children.concat(attachments);
        }

        if (notes != false) {
          children = children.concat(notes);
        }

        for (childID in children) {
          var child = Zotero.Items.get(children[childID]);
          await this.pushItemToArgs(args, child);
          filesFound = true;
        }
      }
    }

    // If no files are specified, exit.
    if (!filesFound) {
      Zotero.debug("ZoteroQuickLook: thinks that no files are selected", 3);
      return false;
    }

    // Custom view commmand does not have base arguments but other view
    // commands have one base argument.
    var argsString = "";

    for (i in args) {
      argsString = argsString + " " + args[i];
    }

    var baseArgs = this.viewerBaseArguments.slice();
    var baseArgsString = "";

    for (i in baseArgs) {
      baseArgsString = baseArgsString + " " + baseArgs[i];
    }

    // If no file arguments were added to the base arguments, exit.
    if (argsString == baseArgsString) {
      Zotero.debug("ZoteroQuickLook: Only linked URLs are selected", 3);
      return false;
    }

    //Write to debug what is called
    Zotero.debug(
      "ZoteroQuickLook: calling a shell command: " +
        this.viewerExecutable.path +
        argsString,
      3
    );

    Zotero.ZoteroQuickLook.proc = Components.classes[
      "@mozilla.org/process/util;1"
    ].createInstance(Components.interfaces.nsIProcess);
    Zotero.ZoteroQuickLook.proc.init(Zotero.ZoteroQuickLook.viewerExecutable);
    Zotero.ZoteroQuickLook.proc.runw(false, args, args.length);
    return true;
  },

  onKey: function (event) {
    return Zotero.ZoteroQuickLook.handleKeyPress(
      event,
      ZoteroPane.getSelectedItems()
    );
  },

  // This function is the actual key listener that decides what to do when a key press event is
  // received. It calls the functions to open or close the quicklook window.
  handleKeyPress: function (event, items) {
    var key = String.fromCharCode(event.which);

    if (
      (key == " " && !(event.ctrlKey || event.altKey || event.metaKey)) ||
      (key == "y" && event.metaKey && !(event.ctrlKey || event.altKey))
    ) {
      //Toggle the quicklook
      if (Zotero.ZoteroQuickLook.isActive()) {
        Zotero.ZoteroQuickLook.closeQuickLook();
      } else {
        Zotero.ZoteroQuickLook.openQuickLook(items);
      }

      Zotero.ZoteroQuickLook.isBrowseMode = false;
    }
    // Esc
    else if (event.keyCode == 27) {
      if (Zotero.ZoteroQuickLook.isActive()) {
        Zotero.ZoteroQuickLook.closeQuickLook();
      }
      Zotero.ZoteroQuickLook.isBrowseMode = false;
    }
    // 38 is arrow up and 40 is arrow down. If quick look is active, we will close it and open it again with the new selection.
    else if (
      (event.keyCode == 38 || event.keyCode == 40) &&
      !(event.ctrlKey || event.altKey || event.metaKey) &&
      (Zotero.ZoteroQuickLook.isActive() || Zotero.ZoteroQuickLook.isBrowseMode)
    ) {
      Zotero.debug("ZoteroQuickLook: is browsing");

      if (!Zotero.ZoteroQuickLook.isBrowseMode) {
        Zotero.ZoteroQuickLook.closeQuickLook();
      }

      success = Zotero.ZoteroQuickLook.openQuickLook(items);

      // If the items were not found, the viewer stays closed. However, if we
      // are browsing through a list of items, we want to reopen the viewer
      // when we hit the next item that has an attachment.
      Zotero.ZoteroQuickLook.isBrowseMode = !success;

      Zotero.debug(
        "ZoteroQuickLook: has browse mode set to " +
          Zotero.ZoteroQuickLook.isBrowseMode,
        3
      );
    }

    return;
  },

  // A small function that determines if the quicklook option should be visible
  // in the context menu for the currently active items.
  showQuickLookMenu: function (event) {
    var doshow = false;

    var items = ZoteroPane.getSelectedItems();

    doshow =
      items.length == 1 &&
      items[0].isAttachment() &&
      !Zotero.ZoteroQuickLook.isActive();

    document.getElementById("zoteroquicklook").hidden = !doshow;
  },
};
