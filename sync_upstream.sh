#!/bin/sh
EX="upstream/xpi/install.rdf upstream/xpi/chrome/content/quickPostForm.xul"
exec tar -c --exclude="$EX" upstream/xpi/ | tar --strip-components=2 -xv
